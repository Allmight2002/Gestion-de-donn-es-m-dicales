-- =============================================================================
-- 20260820210000_base_purge.sql — D10
-- Purge definitive d'une base deja supprimee logiquement.
--
-- PostgreSQL et Storage ne partagent pas une transaction. La purge est donc
-- durablement preparee ici (manifeste + empreinte + cle d'operation), executee
-- cote Edge sur les quatre buckets, puis finalisee ici dans une transaction.
-- Une erreur Storage laisse la base dans l'etat pending et permet un rejeu.
-- Les audit_log et export_log sont explicitement conserves.
-- =============================================================================

alter table public.base
  add column if not exists purge_status text not null default 'none';

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.base'::regclass
       and conname = 'base_purge_status_check'
  ) then
    alter table public.base
      add constraint base_purge_status_check
      check (purge_status in ('none', 'pending'));
  end if;
end
$$;

-- Le journal d'export garde une reference immuable a la base d'origine quand
-- base_id est detache avant la suppression physique de la base.
alter table public.export_log
  add column if not exists base_reference_id uuid;

update public.export_log
   set base_reference_id = base_id
 where base_reference_id is null;

alter table public.export_log
  alter column base_id drop not null,
  alter column base_reference_id set not null;

alter table public.export_log
  drop constraint if exists export_log_base_id_fkey,
  add constraint export_log_base_id_fkey
    foreign key (base_id) references public.base(id) on delete set null;

create index if not exists ix_export_log_base_reference_id
  on public.export_log(base_reference_id);

comment on column public.export_log.base_reference_id is
  'Identifiant immuable de la base ayant produit l export, conserve apres purge de la base.';

-- Compatibilite avec les chemins d ecriture historiques : avant D10, les
-- inserteurs fournissaient base_id mais pas base_reference_id. Le trigger
-- complete cette colonne avant les contraintes, puis interdit de modifier la
-- reference immuable. La mise a NULL de base_id lors de la purge est permise.
create or replace function public.guard_export_base_reference()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' and new.base_reference_id is null then
    new.base_reference_id := new.base_id;
  elsif tg_op = 'UPDATE'
    and new.base_reference_id is distinct from old.base_reference_id then
    raise exception 'BASE_REFERENCE_IMMUTABLE' using errcode = 'P0001';
  end if;
  if new.base_reference_id is null then
    raise exception 'BASE_REFERENCE_REQUIRED' using errcode = 'P0001';
  end if;
  return new;
end
$$;

revoke all on function public.guard_export_base_reference() from public, anon, authenticated;
drop trigger if exists trg_export_log_base_reference on public.export_log;
create trigger trg_export_log_base_reference
  before insert or update of base_id, base_reference_id on public.export_log
  for each row execute function public.guard_export_base_reference();

create table if not exists public.base_purge_operation (
  operation_id          uuid primary key,
  base_id               uuid references public.base(id) on delete set null,
  base_reference_id     uuid not null,
  requested_by          uuid references public.profiles(id) on delete set null,
  base_name             text not null,
  manifest              jsonb not null check (jsonb_typeof(manifest) = 'object'),
  manifest_hash         text not null check (manifest_hash ~ '^[0-9a-f]{64}$'),
  patient_count         integer not null default 0 check (patient_count >= 0),
  encounter_count       integer not null default 0 check (encounter_count >= 0),
  document_count        integer not null default 0 check (document_count >= 0),
  attachment_count      integer not null default 0 check (attachment_count >= 0),
  export_count          integer not null default 0 check (export_count >= 0),
  storage_object_count  integer not null default 0 check (storage_object_count >= 0),
  status                text not null default 'pending' check (status in ('pending', 'completed')),
  created_at            timestamptz not null default now(),
  completed_at          timestamptz,
  unique (base_reference_id)
);

alter table public.base_purge_operation enable row level security;
revoke all on table public.base_purge_operation from public, anon, authenticated;
grant select, insert, update, delete on table public.base_purge_operation to service_role;

comment on table public.base_purge_operation is
  'Manifeste et etat durable d une purge D10; la base_id devient nulle apres purge, base_reference_id reste immuable.';

-- Restauration et purge se serialisent sur la meme ligne. Une restauration ne
-- peut pas ressusciter une base dont les objets Storage sont deja en cours de
-- suppression.
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
  if b.purge_status = 'pending' then
    raise exception 'PURGE_IN_PROGRESS' using errcode = 'P0001';
  end if;
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
end
$$;

drop function if exists public.list_deleted_bases();

create or replace function public.list_deleted_bases()
returns table (
  id                  uuid,
  name                text,
  deleted_at          timestamptz,
  deletion_reason     text,
  purge_eligible_at   timestamptz,
  patient_count       integer,
  encounter_count     integer,
  document_count      integer,
  attachment_count    integer,
  export_count        integer,
  purge_pending       boolean,
  purge_operation_id  uuid
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;

  return query
    select b.id,
           b.name,
           b.deleted_at,
           b.deletion_reason,
           -- Compatibilite de schema pour les clients historiques : la purge
           -- est desormais disponible immediatement, donc l echeance vaut le jour
           -- de la suppression logique.
           b.deleted_at,
           (select count(*)::integer from public.patient p where p.base_id = b.id),
           (select count(*)::integer
              from public.encounter e
              join public.patient p on p.id = e.patient_id
             where p.base_id = b.id),
           (select count(*)::integer from public.raw_document d where d.base_id = b.id),
           (select count(*)::integer
              from public.clinical_attachment a
              join public.patient p on p.id = a.patient_id
             where p.base_id = b.id),
           (select count(*)::integer from public.export_log e where e.base_id = b.id),
           (b.purge_status = 'pending' or op.status = 'pending'),
           op.operation_id
      from public.base b
      left join public.base_purge_operation op
        on op.base_reference_id = b.id and op.status = 'pending'
     where b.owner_user_id = auth.uid()
       and b.deleted_at is not null
     order by b.deleted_at desc;
end
$$;

-- Prepare est l unique point d entree authentifie. Il verrouille la base avant
-- de lire les dependances et persiste la meme operation pour tout rejeu.
create or replace function public.prepare_base_purge(p_base_id uuid, p_operation_id uuid)
returns table (
  status                text,
  code                  text,
  operation_id          uuid,
  base_id               uuid,
  manifest              jsonb,
  manifest_hash         text,
  patient_count         integer,
  encounter_count       integer,
  document_count        integer,
  attachment_count      integer,
  export_count          integer,
  storage_object_count  integer
)
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_base public.base;
  v_operation public.base_purge_operation;
  v_manifest jsonb;
  v_hash text;
  v_patient_count integer;
  v_encounter_count integer;
  v_document_count integer;
  v_attachment_count integer;
  v_export_count integer;
  v_storage_object_count integer;
begin
  if v_uid is null then
    status := 'rejected'; code := 'AUTHENTICATION_REQUIRED'; return next; return;
  end if;
  if p_base_id is null or p_operation_id is null then
    status := 'rejected'; code := 'PURGE_OPERATION_INVALID'; return next; return;
  end if;

  select * into v_base
    from public.base
   where id = p_base_id
   for update;

  if not found then
    select * into v_operation
      from public.base_purge_operation o
     where o.operation_id = p_operation_id
     for update;
    if not found then
      select * into v_operation
        from public.base_purge_operation o
       where o.base_reference_id = p_base_id
       order by created_at desc
       limit 1
       for update;
    end if;
    if found and v_operation.status = 'completed' then
      status := 'completed'; code := 'ALREADY_PURGED'; operation_id := v_operation.operation_id;
      base_id := p_base_id; return next; return;
    end if;
    status := 'rejected'; code := 'BASE_NOT_FOUND'; base_id := p_base_id; return next; return;
  end if;

  if v_base.owner_user_id is distinct from v_uid then
    status := 'rejected'; code := 'OWNER_REQUIRED'; base_id := p_base_id; return next; return;
  end if;

  select * into v_operation
    from public.base_purge_operation o
   where o.operation_id = p_operation_id
   for update;
  if found and v_operation.base_reference_id is distinct from p_base_id then
    status := 'rejected'; code := 'PURGE_OPERATION_CONFLICT'; base_id := p_base_id; return next; return;
  end if;

  if v_base.deleted_at is null then
    status := 'rejected'; code := 'BASE_ACTIVE'; base_id := p_base_id; return next; return;
  end if;
  if v_base.purge_status = 'pending' then
    if not found then
      select * into v_operation
        from public.base_purge_operation o
       where o.base_reference_id = p_base_id and o.status = 'pending'
       for update;
    end if;
    if not found then
      status := 'rejected'; code := 'PURGE_STATE_INCONSISTENT'; base_id := p_base_id; return next; return;
    end if;
    status := 'pending'; code := 'PURGE_IN_PROGRESS'; operation_id := v_operation.operation_id;
    base_id := p_base_id; manifest := v_operation.manifest; manifest_hash := v_operation.manifest_hash;
    patient_count := v_operation.patient_count; encounter_count := v_operation.encounter_count;
    document_count := v_operation.document_count; attachment_count := v_operation.attachment_count;
    export_count := v_operation.export_count; storage_object_count := v_operation.storage_object_count;
    return next; return;
  end if;

  if v_base.purge_status is distinct from 'none' then
    status := 'rejected'; code := 'PURGE_STATE_INVALID'; base_id := p_base_id; return next; return;
  end if;
  if found and v_operation.status = 'completed' then
    status := 'rejected'; code := 'PURGE_STATE_INCONSISTENT'; base_id := p_base_id; return next; return;
  end if;

  -- Toutes les lignes connues de Storage sont recensees. Un chemin hors du
  -- prefixe de la base bloque la purge plutot que de supprimer un autre objet.
  if exists (
    with objects(bucket, path) as (
      select 'clinical-attachments', a.storage_path
        from public.clinical_attachment a join public.patient p on p.id = a.patient_id
       where p.base_id = p_base_id and a.storage_path is not null
      union all
      select 'clinical-attachments', a.quarantine_path
        from public.clinical_attachment a join public.patient p on p.id = a.patient_id
       where p.base_id = p_base_id and a.quarantine_path is not null
      union all
      select 'raw-documents', d.storage_path from public.raw_document d
       where d.base_id = p_base_id and d.storage_path is not null
      union all
      select 'raw-documents', d.quarantine_path from public.raw_document d
       where d.base_id = p_base_id and d.quarantine_path is not null
      union all
      select 'scientific-exports', e.stored_file_path from public.export_log e
       where e.base_id = p_base_id and e.stored_file_path is not null
      union all
      select t.bucket, t.path from public.upload_ticket t
       where t.base_id = p_base_id
      union all
      select q.source_bucket, q.source_path from public.quarantine_move_log q
       where q.base_id = p_base_id
      union all
      select q.quarantine_bucket, q.quarantine_path from public.quarantine_move_log q
       where q.base_id = p_base_id
    )
    select 1 from objects
     where bucket not in ('clinical-attachments', 'raw-documents', 'scientific-exports', 'quarantined-uploads')
        or path is null
        or path not like (p_base_id::text || '/%')
        or path like '%..%'
        or path like '%//%'
  ) then
    status := 'rejected'; code := 'STORAGE_MANIFEST_INVALID'; base_id := p_base_id; return next; return;
  end if;

  with objects(bucket, path) as (
    select 'clinical-attachments', a.storage_path
      from public.clinical_attachment a join public.patient p on p.id = a.patient_id
     where p.base_id = p_base_id and a.storage_path is not null
    union all
    select 'clinical-attachments', a.quarantine_path
      from public.clinical_attachment a join public.patient p on p.id = a.patient_id
     where p.base_id = p_base_id and a.quarantine_path is not null
    union all
    select 'raw-documents', d.storage_path from public.raw_document d
     where d.base_id = p_base_id and d.storage_path is not null
    union all
    select 'raw-documents', d.quarantine_path from public.raw_document d
     where d.base_id = p_base_id and d.quarantine_path is not null
    union all
    select 'scientific-exports', e.stored_file_path from public.export_log e
     where e.base_id = p_base_id and e.stored_file_path is not null
    union all
    select t.bucket, t.path from public.upload_ticket t
     where t.base_id = p_base_id
    union all
    select q.source_bucket, q.source_path from public.quarantine_move_log q
     where q.base_id = p_base_id
    union all
    select q.quarantine_bucket, q.quarantine_path from public.quarantine_move_log q
     where q.base_id = p_base_id
  )
  select jsonb_build_object(
           'objects', coalesce(
             jsonb_agg(jsonb_build_object('bucket', x.bucket, 'path', x.path) order by x.bucket, x.path),
             '[]'::jsonb
           )
         )
    into v_manifest
    from (select distinct bucket, path from objects) x;

  -- `digest` est expose dans `extensions` sur Supabase et dans `public` par le
  -- shim PostgreSQL des tests ; le search_path est fixe ci-dessus dans les deux
  -- cas, sans jamais dependre du search_path de la session appelante.
  v_hash := encode(digest(convert_to(v_manifest::text, 'UTF8'), 'sha256'), 'hex');
  select count(*)::integer into v_storage_object_count
    from jsonb_array_elements(v_manifest -> 'objects');
  select count(*)::integer into v_patient_count from public.patient p where p.base_id = p_base_id;
  select count(*)::integer
    into v_encounter_count
    from public.encounter e join public.patient p on p.id = e.patient_id
   where p.base_id = p_base_id;
  select count(*)::integer into v_document_count from public.raw_document d where d.base_id = p_base_id;
  select count(*)::integer
    into v_attachment_count
    from public.clinical_attachment a join public.patient p on p.id = a.patient_id
   where p.base_id = p_base_id;
  select count(*)::integer into v_export_count from public.export_log e where e.base_id = p_base_id;

  insert into public.base_purge_operation(
    operation_id, base_id, base_reference_id, requested_by, base_name, manifest, manifest_hash,
    patient_count, encounter_count, document_count, attachment_count, export_count, storage_object_count
  ) values (
    p_operation_id, p_base_id, p_base_id, v_uid, v_base.name, v_manifest, v_hash,
    v_patient_count, v_encounter_count, v_document_count, v_attachment_count, v_export_count, v_storage_object_count
  ) returning * into v_operation;

  update public.base set purge_status = 'pending' where id = p_base_id;

  status := 'ready'; code := 'PURGE_PREPARED'; operation_id := v_operation.operation_id; base_id := p_base_id;
  manifest := v_operation.manifest; manifest_hash := v_operation.manifest_hash;
  patient_count := v_operation.patient_count; encounter_count := v_operation.encounter_count;
  document_count := v_operation.document_count; attachment_count := v_operation.attachment_count;
  export_count := v_operation.export_count; storage_object_count := v_operation.storage_object_count;
  return next;
end
$$;

-- Finalisation strictement serveur : elle ne doit jamais etre appelable par un
-- JWT utilisateur. p_actor_id est celui authentifie lors de prepare.
create or replace function public.finalize_base_purge(
  p_operation_id uuid,
  p_manifest_hash text,
  p_actor_id uuid
)
returns table(status text, code text, operation_id uuid, base_id uuid)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_operation public.base_purge_operation;
  v_base public.base;
  v_export_count integer;
  v_deleted integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    status := 'rejected'; code := 'SERVER_REQUIRED'; return next; return;
  end if;
  if p_operation_id is null or p_manifest_hash is null or p_actor_id is null then
    status := 'rejected'; code := 'PURGE_OPERATION_INVALID'; return next; return;
  end if;

  select * into v_operation
    from public.base_purge_operation o
   where o.operation_id = p_operation_id
   for update;
  if not found then
    status := 'rejected'; code := 'PURGE_OPERATION_NOT_FOUND'; operation_id := p_operation_id;
    return next; return;
  end if;
  if v_operation.status = 'completed' then
    status := 'completed'; code := 'ALREADY_PURGED'; operation_id := p_operation_id;
    base_id := v_operation.base_reference_id; return next; return;
  end if;
  if v_operation.requested_by is distinct from p_actor_id then
    status := 'rejected'; code := 'PURGE_ACTOR_MISMATCH'; operation_id := p_operation_id;
    return next; return;
  end if;
  if v_operation.manifest_hash is distinct from lower(btrim(p_manifest_hash)) then
    status := 'rejected'; code := 'MANIFEST_MISMATCH'; operation_id := p_operation_id;
    return next; return;
  end if;

  select * into v_base
    from public.base
   where id = v_operation.base_reference_id
   for update;
  if not found then
    status := 'rejected'; code := 'BASE_NOT_FOUND'; operation_id := p_operation_id;
    base_id := v_operation.base_reference_id; return next; return;
  end if;
  if v_base.deleted_at is null then
    status := 'rejected'; code := 'BASE_ACTIVE'; operation_id := p_operation_id; base_id := v_base.id;
    return next; return;
  end if;
  if v_base.purge_status <> 'pending' then
    status := 'rejected'; code := 'PURGE_STATE_INVALID'; operation_id := p_operation_id; base_id := v_base.id;
    return next; return;
  end if;

  -- Le journal d export est detache, jamais supprime. base_reference_id et les
  -- metadonnees immuables permettent l audit meme apres disparition de la base.
  update public.export_log e
     set base_id = null
   where e.base_id = v_base.id;
  get diagnostics v_export_count = row_count;

  insert into public.audit_log(user_id, action, entity, entity_id, base_id, metadata)
  values (
    p_actor_id, 'base_purged', 'base', v_base.id, v_base.id,
    jsonb_build_object(
      'operation_id', p_operation_id,
      'base_reference_id', v_base.id,
      'patient_count', v_operation.patient_count,
      'encounter_count', v_operation.encounter_count,
      'document_count', v_operation.document_count,
      'attachment_count', v_operation.attachment_count,
      'export_journal_count', v_export_count,
      'storage_object_count', v_operation.storage_object_count,
      'storage_strategy', 'objects_removed_journal_preserved'
    )
  );

  -- Ordre explicite : les dependances NO ACTION/RESTRICT sont videes avant
  -- leurs parents. Les cascades restantes du DELETE final ne touchent ni audit
  -- (SET NULL), ni journal d export (base_id deja detache), ni operation.
  delete from public.offline_encounter_operation o
   using public.encounter e, public.patient p
   where o.encounter_id = e.id and e.patient_id = p.id and p.base_id = v_base.id;

  delete from public.patient_curation_idempotency i
   where exists (
           select 1 from public.patient p
            where p.id = i.patient_id and p.base_id = v_base.id
         )
      or exists (
           select 1 from public.raw_submission s
            where s.id = i.submission_id and s.base_id = v_base.id
         )
      or exists (
           select 1 from public.curation_task t
            where t.id = i.task_id and t.base_id = v_base.id
         );

  delete from public.cohort_encounter_member m
   using public.cohort c
   where m.cohort_id = c.id and c.base_id = v_base.id;
  delete from public.cohort_encounter_member m
   using public.encounter e, public.patient p
   where m.encounter_id = e.id and e.patient_id = p.id and p.base_id = v_base.id;
  delete from public.cohort_member m
   using public.cohort c
   where m.cohort_id = c.id and c.base_id = v_base.id;
  delete from public.cohort_member m
   using public.patient p
   where m.patient_id = p.id and p.base_id = v_base.id;

  delete from public.curation_clarification c where c.base_id = v_base.id;
  delete from public.curation_draft d where d.base_id = v_base.id;
  delete from public.raw_document d where d.base_id = v_base.id;
  delete from public.clinical_attachment a
   using public.patient p
   where a.patient_id = p.id and p.base_id = v_base.id;
  delete from public.encounter e
   using public.patient p
   where e.patient_id = p.id and p.base_id = v_base.id;
  delete from public.curation_task t where t.base_id = v_base.id;
  delete from public.raw_submission s where s.base_id = v_base.id;
  delete from public.raw_submission s
   using public.patient p
   where s.target_patient_id = p.id and p.base_id = v_base.id;
  delete from public.patient_identity i where i.base_id = v_base.id;
  delete from public.patient p where p.base_id = v_base.id;

  delete from public.import_row_hash h where h.base_id = v_base.id;
  delete from public.import_batch b where b.base_id = v_base.id;
  delete from public.mission_credential_operation o where o.base_id = v_base.id;
  delete from public.mission_account_credential c where c.base_id = v_base.id;
  delete from public.quarantine_move_log q where q.base_id = v_base.id;
  delete from public.field_change_log f where f.base_id = v_base.id;
  delete from public.cohort c where c.base_id = v_base.id;
  delete from public.base_access a where a.base_id = v_base.id;
  delete from public.base_invitation i where i.base_id = v_base.id;
  delete from public.research_group_base g where g.base_id = v_base.id;
  delete from public.upload_ticket t where t.base_id = v_base.id;

  delete from public.base where id = v_base.id;
  get diagnostics v_deleted = row_count;
  if v_deleted <> 1 then
    raise exception 'D10_BASE_DELETE_INCOMPLETE' using errcode = 'P0001';
  end if;

  update public.base_purge_operation o
     set status = 'completed', completed_at = now(), base_id = null
   where o.operation_id = p_operation_id;

  status := 'completed'; code := 'PURGED'; operation_id := p_operation_id; base_id := v_base.id;
  return next;
end
$$;

revoke all on function public.restore_deleted_base(uuid) from public, anon;
grant execute on function public.restore_deleted_base(uuid) to authenticated;
revoke all on function public.list_deleted_bases() from public, anon;
grant execute on function public.list_deleted_bases() to authenticated;
revoke all on function public.prepare_base_purge(uuid, uuid) from public, anon;
grant execute on function public.prepare_base_purge(uuid, uuid) to authenticated;
revoke all on function public.finalize_base_purge(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.finalize_base_purge(uuid, text, uuid) to service_role, postgres;
