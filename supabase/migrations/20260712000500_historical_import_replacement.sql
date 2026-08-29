-- Historical processing batches with counters but without import_batch_row
-- receipts are ambiguous. Preserve them, expose them for cancellation, and
-- allow a replacement only when durable source receipts prove every former
-- successful row.

alter table public.import_batch
  add column if not exists resume_state text not null default 'modern'
    check (resume_state in ('modern','historical_unsafe','historical_cancelled','replacement')),
  add column if not exists replaces_batch_id uuid references public.import_batch(id),
  add column if not exists replacement_report jsonb;

update public.import_batch b
   set resume_state = 'historical_unsafe'
 where b.status = 'processing' and b.row_count > 0
   and not exists (select 1 from public.import_batch_row r where r.batch_id = b.id)
   and b.resume_state = 'modern';

create unique index if not exists ux_import_active_historical_replacement
  on public.import_batch(replaces_batch_id)
  where replaces_batch_id is not null and status <> 'cancelled';

create or replace function public.cancel_import_batch(p_batch_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_batch public.import_batch;
begin
  select * into v_batch from public.import_batch where id = p_batch_id for update;
  if not found then raise exception 'Lot d''import introuvable'; end if;
  if not public.can_edit_structured_data(v_batch.base_id) then raise exception 'Acces refuse'; end if;
  if v_batch.imported_by is distinct from auth.uid() then raise exception 'Lot d''import d''un autre utilisateur'; end if;
  if v_batch.status <> 'processing' then raise exception 'Lot deja cloture (statut=%)', v_batch.status; end if;
  update public.import_batch
     set status = 'cancelled',
         resume_state = case when resume_state = 'historical_unsafe' then 'historical_cancelled' else resume_state end,
         updated_at = now()
   where id = p_batch_id;
end $$;
revoke all on function public.cancel_import_batch(uuid) from public, anon;
grant execute on function public.cancel_import_batch(uuid) to authenticated;

create or replace function public.get_import_batch_state(p_batch_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_batch public.import_batch;
begin
  select * into v_batch from public.import_batch where id = p_batch_id;
  if not found then raise exception 'Lot d''import introuvable'; end if;
  if not public.can_edit_structured_data(v_batch.base_id)
     or v_batch.imported_by is distinct from auth.uid() then raise exception 'Acces refuse'; end if;
  return jsonb_build_object(
    'batch_id', v_batch.id, 'status', v_batch.status,
    'resume_state', v_batch.resume_state, 'replaces_batch_id', v_batch.replaces_batch_id,
    'expected_rows', v_batch.expected_rows, 'row_count', v_batch.row_count,
    'error_count', v_batch.error_count,
    'succeeded_source_rows', coalesce((
      select jsonb_agg(source_row_number order by source_row_number)
        from public.import_batch_row where batch_id=p_batch_id and outcome='succeeded'
    ), '[]'::jsonb),
    'rejected_source_rows', coalesce((
      select jsonb_agg(source_row_number order by source_row_number)
        from public.import_batch_row where batch_id=p_batch_id and outcome='rejected'
    ), '[]'::jsonb)
  );
end $$;
revoke all on function public.get_import_batch_state(uuid) from public, anon;
grant execute on function public.get_import_batch_state(uuid) to authenticated;

create or replace function public.begin_import_batch(
  p_base_id uuid, p_file_hash text, p_template_version_id uuid default null,
  p_conflict text default 'fill', p_status text default 'draft', p_expected_rows integer default null
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tv uuid;
  v_id uuid;
  v_batch public.import_batch;
  v_historical public.import_batch;
  v_has_historical boolean := false;
  v_proven_successes integer;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  if not public.can_edit_structured_data(p_base_id) then raise exception 'Acces refuse'; end if;
  if p_file_hash is null then raise exception 'Empreinte de fichier requise pour un import par lots'; end if;
  if p_expected_rows is not null and p_expected_rows < 1 then raise exception 'Nombre de lignes attendu invalide'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_base_id::text || '|' || p_file_hash, 0));
  select current_template_version_id into v_tv from public.base where id=p_base_id and deleted_at is null;
  if v_tv is null then raise exception 'Base introuvable'; end if;
  if p_template_version_id is not null and p_template_version_id <> v_tv then
    raise exception 'Le gabarit de la base a change depuis l''apercu ; relancez l''apercu.';
  end if;
  if exists (select 1 from public.import_batch where base_id=p_base_id and file_hash=p_file_hash and status='completed') then
    raise exception 'Ce fichier a deja ete importe sur cette base (doublon evite).';
  end if;

  select * into v_batch from public.import_batch
   where base_id=p_base_id and file_hash=p_file_hash and status='processing'
   order by created_at limit 1 for update;
  if found then
    if v_batch.imported_by is distinct from auth.uid() then raise exception 'Lot d''import en cours par un autre utilisateur'; end if;
    if v_batch.conflict_mode is distinct from p_conflict
       or v_batch.template_version_id is distinct from v_tv
       or v_batch.target_validation_status is distinct from p_status then
      raise exception 'Parametres incoherents avec le lot existant';
    end if;
    if v_batch.expected_rows is not null and p_expected_rows is distinct from v_batch.expected_rows then
      raise exception 'Nombre de lignes incoherent avec le lot existant';
    end if;
    if v_batch.expected_rows is null and p_expected_rows is not null then
      update public.import_batch set expected_rows=p_expected_rows where id=v_batch.id;
    end if;
    if v_batch.resume_state='historical_unsafe' or (v_batch.row_count>0 and not exists (
      select 1 from public.import_batch_row r where r.batch_id=v_batch.id
    )) then
      update public.import_batch set resume_state='historical_unsafe' where id=v_batch.id;
      -- Return the id instead of raising: the UI can now expose cancel_import_batch.
      return v_batch.id;
    end if;
    return v_batch.id;
  end if;

  select * into v_historical from public.import_batch
   where base_id=p_base_id and file_hash=p_file_hash and status='cancelled'
     and resume_state='historical_cancelled' and imported_by=auth.uid()
   order by updated_at desc limit 1 for update;
  v_has_historical := found;
  if v_has_historical then
    if v_historical.conflict_mode is distinct from p_conflict
       or v_historical.template_version_id is distinct from v_tv
       or v_historical.target_validation_status is distinct from p_status then
      raise exception 'Parametres incoherents avec le lot historique';
    end if;
    if v_historical.expected_rows is not null and p_expected_rows is distinct from v_historical.expected_rows then
      raise exception 'Nombre de lignes incoherent avec le lot historique';
    end if;
    if exists (select 1 from public.import_batch r where r.replaces_batch_id=v_historical.id and r.status<>'cancelled') then
      raise exception 'Le lot historique possede deja un remplacement actif ou cloture';
    end if;
    select count(*)::integer into v_proven_successes
      from public.import_row_hash h
     where h.batch_id=v_historical.id and h.hash_kind='source'
       and h.source_file_hash=v_historical.file_hash
       and h.source_row_number is not null and h.normalized_row_hash is not null;
    if v_proven_successes <> greatest(v_historical.row_count-v_historical.error_count,0) then
      raise exception 'Preuves historiques incompletes : remplacement automatique refuse, revue manuelle requise';
    end if;
  end if;

  insert into public.import_batch(
    base_id,file_hash,template_version_id,conflict_mode,target_validation_status,
    expected_rows,imported_by,status,resume_state,replaces_batch_id
  ) values (
    p_base_id,p_file_hash,v_tv,p_conflict,p_status,
    coalesce(p_expected_rows,v_historical.expected_rows),auth.uid(),'processing',
    case when v_has_historical then 'replacement' else 'modern' end,
    case when v_has_historical then v_historical.id else null end
  ) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.begin_import_batch(uuid,text,uuid,text,text,integer) from public, anon;
grant execute on function public.begin_import_batch(uuid,text,uuid,text,text,integer) to authenticated;

alter function public.import_records(uuid, jsonb, boolean, text, text, text, uuid, uuid)
  rename to import_records_with_receipts;
revoke all on function public.import_records_with_receipts(uuid,jsonb,boolean,text,text,text,uuid,uuid)
  from public, anon, authenticated;

create or replace function public.import_records(
  p_base_id uuid, p_rows jsonb, p_dry_run boolean default true,
  p_status text default 'draft', p_conflict text default 'fill',
  p_file_hash text default null, p_template_version_id uuid default null,
  p_batch_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_batch public.import_batch;
  v_delegate jsonb := '[]'::jsonb;
  v_report jsonb;
  v_results jsonb;
  v_existing public.import_batch_row;
  r jsonb;
  v_source integer;
  v_hash text;
  v_historical_proven integer := 0;
  v_conflicts integer := 0;
  v_row_count integer := 0;
  v_error_count integer := 0;
  v_total_proven integer := 0;
  v_total_conflicts integer := 0;
begin
  if p_batch_id is null or p_dry_run then
    return public.import_records_with_receipts(
      p_base_id,p_rows,p_dry_run,p_status,p_conflict,p_file_hash,p_template_version_id,p_batch_id
    );
  end if;

  select * into v_batch from public.import_batch where id=p_batch_id for update;
  if not found then raise exception 'Lot d''import introuvable'; end if;
  if v_batch.base_id is distinct from p_base_id then raise exception 'Lot d''import rattache a une autre base'; end if;
  if not public.can_edit_structured_data(v_batch.base_id)
     or v_batch.imported_by is distinct from auth.uid() then raise exception 'Acces refuse'; end if;
  if v_batch.status <> 'processing' then raise exception 'Lot d''import deja cloture'; end if;
  if v_batch.conflict_mode is distinct from p_conflict then
    raise exception 'Mode de conflit incoherent avec le lot';
  end if;
  if v_batch.target_validation_status is distinct from p_status then
    raise exception 'Statut cible incoherent avec le lot';
  end if;
  if p_template_version_id is not null and p_template_version_id is distinct from v_batch.template_version_id then
    raise exception 'Version de gabarit incoherente avec le lot';
  end if;
  if p_file_hash is not null and p_file_hash is distinct from v_batch.file_hash then
    raise exception 'Empreinte de fichier incoherente avec le lot';
  end if;
  if v_batch.resume_state='historical_unsafe' then
    raise exception 'Ancien lot sans recus non reprenable : annulez-le puis recreez le lot';
  end if;
  if v_batch.resume_state <> 'replacement' then
    return public.import_records_with_receipts(
      p_base_id,p_rows,false,p_status,p_conflict,p_file_hash,p_template_version_id,p_batch_id
    );
  end if;

  for r in select value from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) loop
    v_source := nullif(r->>'source_row_number','')::integer;
    v_hash := nullif(btrim(r->>'normalized_row_hash'),'');
    if v_source is null or v_hash is null then
      raise exception 'Chaque ligne du remplacement doit fournir sa provenance';
    end if;
    select * into v_existing from public.import_batch_row
     where batch_id=p_batch_id and source_row_number=v_source;
    if found then
      if v_existing.normalized_row_hash is distinct from v_hash then
        raise exception 'Ligne source % incoherente avec le remplacement', v_source;
      end if;
      v_delegate := v_delegate || jsonb_build_array(r);
      continue;
    end if;

    if exists (
      select 1 from public.import_row_hash h
       where h.batch_id=v_batch.replaces_batch_id and h.hash_kind='source'
         and h.source_file_hash=v_batch.file_hash and h.source_row_number=v_source
         and h.normalized_row_hash=v_hash
    ) then
      insert into public.import_batch_row(batch_id,source_row_number,normalized_row_hash,outcome,result)
      values(p_batch_id,v_source,v_hash,'succeeded',jsonb_build_object('classification','historical_source_proven'));
      v_historical_proven := v_historical_proven + 1;
    elsif exists (
      select 1 from public.import_row_hash h
       where h.batch_id=v_batch.replaces_batch_id and h.hash_kind='source'
         and h.source_file_hash=v_batch.file_hash and h.source_row_number=v_source
    ) then
      insert into public.import_batch_row(batch_id,source_row_number,normalized_row_hash,outcome,result)
      values(p_batch_id,v_source,v_hash,'rejected',jsonb_build_object(
        'classification','historical_source_changed',
        'message','Ligne deja appliquee avec un contenu different : revue manuelle requise'
      ));
      v_conflicts := v_conflicts + 1;
    else
      v_delegate := v_delegate || jsonb_build_array(r);
    end if;
  end loop;

  if jsonb_array_length(v_delegate)>0 then
    v_report := public.import_records_with_receipts(
      p_base_id,v_delegate,false,p_status,p_conflict,p_file_hash,p_template_version_id,p_batch_id
    );
  else
    v_report := jsonb_build_object(
      'patients_new',0,'patients_updated',0,'encounters',0,'newly_imported',0,'already_processed',0,'errors','[]'::jsonb
    );
  end if;

  select count(*)::integer,
         count(*) filter(where outcome='rejected')::integer,
         count(*) filter(where result->>'classification'='historical_source_proven')::integer,
         count(*) filter(where result->>'classification'='historical_source_changed')::integer,
         coalesce(jsonb_agg(jsonb_build_object(
           'source_row_number',source_row_number,'outcome',outcome,'result',result
         ) order by source_row_number),'[]'::jsonb)
    into v_row_count,v_error_count,v_total_proven,v_total_conflicts,v_results
    from public.import_batch_row where batch_id=p_batch_id;

  update public.import_batch set
    row_count=v_row_count,error_count=v_error_count,updated_at=now(),
    replacement_report=jsonb_build_object(
      'historical_batch_id',v_batch.replaces_batch_id,
      'historical_source_proven',v_total_proven,
      'processed_without_historical_receipt',v_row_count-v_total_proven-v_total_conflicts,
      'rejected',v_error_count,'conflicts',v_total_conflicts
    )
   where id=p_batch_id;

  return v_report || jsonb_build_object(
    'historical_replaced',v_batch.replaces_batch_id,
    'historical_source_proven',v_historical_proven,
    'conflicts',v_conflicts,'rejected',v_error_count,'error_count',v_error_count,
    'line_results',v_results,'batch',public.get_import_batch_state(p_batch_id)
  );
end $$;
revoke all on function public.import_records(uuid,jsonb,boolean,text,text,text,uuid,uuid) from public, anon;
grant execute on function public.import_records(uuid,jsonb,boolean,text,text,text,uuid,uuid) to authenticated;
