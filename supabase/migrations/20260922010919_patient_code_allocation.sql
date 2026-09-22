-- =============================================================================
-- L42 : allocation transactionnelle des codes patients par base.
--
-- Le compteur est un objet interne : aucun role Data API ne lit ou n'ecrit la
-- table directement. La RPC valide le meme droit de creation que le parcours
-- patient direct, verrouille la base puis le compteur, et ne progresse que dans
-- la transaction qui cree effectivement le patient (ou la soumission).
-- =============================================================================
begin;

create table public.patient_code_allocator (
  base_id     uuid primary key references public.base(id) on delete cascade,
  next_number bigint not null check (next_number > 0)
);

alter table public.patient_code_allocator enable row level security;
revoke all on table public.patient_code_allocator from public, anon, authenticated;

-- Initialisation compatible avec les bases deja peuplees. On tient compte des
-- deux zones et des lignes supprimees logiquement afin de ne jamais reutiliser
-- un code historique. Les codes hors convention P-<nombre> restent valides,
-- mais ne participent pas a cette sequence numerique.
insert into public.patient_code_allocator (base_id, next_number)
select b.id,
  case
    when greatest(coalesce(p.max_number, 0), coalesce(i.max_number, 0)) >= 9223372036854775806
      then 9223372036854775806
    else greatest(coalesce(p.max_number, 0), coalesce(i.max_number, 0)) + 1
  end
from public.base b
left join lateral (
  select max(case
    when patient_code ~ '^P-[0-9]{1,18}$' then substring(patient_code from 3)::bigint
    else null
  end) as max_number
  from public.patient
  where base_id = b.id
) p on true
left join lateral (
  select max(case
    when patient_code ~ '^P-[0-9]{1,18}$' then substring(patient_code from 3)::bigint
    else null
  end) as max_number
  from public.patient_identity
  where base_id = b.id
) i on true;

create or replace function public.allocate_patient_code(p_base_id uuid)
returns text
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_base_id uuid;
  v_next bigint;
  v_max bigint;
  v_code text;
begin
  -- Cette vérification est faite avant toute lecture du compteur : un compte
  -- sans droit ne peut donc ni allouer ni observer l'etat d'une base.
  if auth.uid() is null or not public.can_create_structured_data(p_base_id) then
    raise exception 'Acces refuse';
  end if;

  -- Le verrou de base serialise toutes les allocations de cette base, y
  -- compris les appels venant de RPC differentes.
  select id
    into v_base_id
    from public.base
   where id = p_base_id and deleted_at is null
   for update;
  if not found then
    raise exception 'Base introuvable';
  end if;

  insert into public.patient_code_allocator (base_id, next_number)
  values (p_base_id, 1)
  on conflict (base_id) do nothing;

  select next_number
    into v_next
    from public.patient_code_allocator
   where base_id = p_base_id
   for update;

  -- Relecture des donnees courantes : elle couvre les patients historiques
  -- ajoutes avant la migration et les codes explicites legacy.
  select greatest(
    coalesce((
      select max(case
        when patient_code ~ '^P-[0-9]{1,18}$' then substring(patient_code from 3)::bigint
        else null
      end)
      from public.patient
      where base_id = p_base_id
    ), 0),
    coalesce((
      select max(case
        when patient_code ~ '^P-[0-9]{1,18}$' then substring(patient_code from 3)::bigint
        else null
      end)
      from public.patient_identity
      where base_id = p_base_id
    ), 0))
    into v_max;

  -- Garder une marge pour incrementer le compteur dans la meme transaction.
  if v_max >= 9223372036854775806 then
    raise exception 'Compteur de codes patient epuise';
  end if;
  v_next := greatest(v_next, v_max + 1);
  if v_next >= 9223372036854775807 then
    raise exception 'Compteur de codes patient epuise';
  end if;

  v_code := 'P-' || lpad(v_next::text, 4, '0');
  update public.patient_code_allocator
     set next_number = v_next + 1
   where base_id = p_base_id;
  return v_code;
end;
$$;

revoke all on function public.allocate_patient_code(uuid) from public, anon;
grant execute on function public.allocate_patient_code(uuid) to authenticated;

-- Le code reste optionnel pour les appelants legacy explicites (notamment le
-- replay hors-ligne). Les parcours en ligne passent NULL et obtiennent le code
-- alloue ci-dessus.
create or replace function public.create_patient(
  p_base_id            uuid,
  p_patient_code       text,
  p_full_name          text,
  p_date_of_birth      date,
  p_phone              text,
  p_address            text,
  p_external_identifier text,
  p_permanent_data     jsonb
) returns public.patient
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_tv      uuid;
  v_patient public.patient;
  v_code    text;
  v_can_write_identity boolean;
begin
  if auth.uid() is null or not public.can_create_structured_data(p_base_id) then
    raise exception 'Acces refuse';
  end if;

  v_can_write_identity := public.can_write_identity(p_base_id);
  if not v_can_write_identity then
    if coalesce(btrim(p_full_name), '') <> ''
       or p_date_of_birth is not null
       or coalesce(btrim(p_phone), '') <> ''
       or coalesce(btrim(p_address), '') <> ''
       or coalesce(btrim(p_external_identifier), '') <> '' then
      raise exception 'Acces identite requis pour renseigner l''identite nominative';
    end if;
  end if;

  select current_template_version_id
    into v_tv
    from public.base
   where id = p_base_id and deleted_at is null
   for update;
  if v_tv is null then raise exception 'La base n''a pas de version de gabarit courante'; end if;

  -- Re-validation SERVEUR (§5.4/§5.5) : bornes / listes / type des donnees permanentes.
  perform public.assert_data_valid(v_tv, 'patient', coalesce(p_permanent_data, '{}'::jsonb));

  if not public.can_edit_structured_data(p_base_id) then
    perform public.assert_required_complete(v_tv, 'patient', coalesce(p_permanent_data, '{}'::jsonb));
  end if;

  v_code := nullif(btrim(coalesce(p_patient_code, '')), '');
  if v_code is null then
    v_code := public.allocate_patient_code(p_base_id);
  end if;

  insert into public.patient_identity
    (base_id, patient_code, full_name, date_of_birth, phone, address, external_identifier, created_by)
  values
    (p_base_id, v_code,
     case when v_can_write_identity then p_full_name end,
     case when v_can_write_identity then p_date_of_birth end,
     case when v_can_write_identity then p_phone end,
     case when v_can_write_identity then p_address end,
     case when v_can_write_identity then p_external_identifier end,
     auth.uid());

  insert into public.patient
    (base_id, patient_code, template_version_id, data, collection_mode, validation_status, created_by)
  values
    (p_base_id, v_code, v_tv, coalesce(p_permanent_data, '{}'::jsonb), 'direct', 'draft', auth.uid())
  returning * into v_patient;

  return v_patient;
end $$;

revoke all on function public.create_patient(uuid, text, text, date, text, text, text, jsonb) from public, anon;
grant execute on function public.create_patient(uuid, text, text, date, text, text, text, jsonb) to authenticated;

create or replace function public.create_patient_curation_submission(
  p_base_id uuid,
  p_patient_code text,
  p_full_name text,
  p_date_of_birth date,
  p_phone text,
  p_address text,
  p_external_identifier text,
  p_idempotency_key text
) returns table(patient_id uuid, patient_code text, submission_id uuid, task_id uuid, replayed boolean)
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_existing public.patient_curation_idempotency;
  v_tv uuid; v_patient public.patient; v_submission uuid; v_task public.curation_task;
  v_payload jsonb; v_fingerprint text; v_case_code text; v_code text;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then raise exception 'Cle d''idempotence requise'; end if;
  if length(btrim(p_idempotency_key)) > 200 then raise exception 'Cle d''idempotence invalide'; end if;
  -- Lot 3 : toutes les policies et RPC suivantes (documents, soumission,
  -- finalisation) restent reservees au proprietaire. Autoriser ici un editeur
  -- creerait un cas qu'il ne pourrait ensuite ni voir ni poursuivre.
  if not public.is_base_owner(p_base_id) then raise exception 'Reserve au proprietaire de la base'; end if;
  if nullif(btrim(p_full_name), '') is null or p_date_of_birth is null then raise exception 'Identite patient requise'; end if;

  v_payload := jsonb_build_object('base_id', p_base_id,
    'patient_code', nullif(btrim(coalesce(p_patient_code, '')), ''),
    'full_name', btrim(p_full_name), 'date_of_birth', p_date_of_birth, 'phone', p_phone,
    'address', p_address, 'external_identifier', p_external_identifier);
  v_fingerprint := encode(digest(convert_to(v_payload::text, 'UTF8'), 'sha256'), 'hex');
  -- Serialise les doubles clics/retries de la meme intention sans tenir de verrou hors transaction.
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':' || btrim(p_idempotency_key), 0));
  select * into v_existing from public.patient_curation_idempotency
   where user_id = auth.uid() and idempotency_key = btrim(p_idempotency_key) for update;
  if found then
    if v_existing.request_fingerprint is distinct from v_fingerprint then
      raise exception 'CLE_IDEMPOTENCE_CONTRADICTOIRE : cette cle correspond a une autre demande' using errcode = 'P0001';
    end if;
    return query select v_existing.patient_id, (select p.patient_code from public.patient p where p.id = v_existing.patient_id),
      v_existing.submission_id, v_existing.task_id, true;
    return;
  end if;

  select current_template_version_id
    into v_tv
    from public.base
   where id = p_base_id and deleted_at is null
   for update;
  if v_tv is null then raise exception 'La base n''a pas de version de gabarit courante'; end if;
  perform public.assert_data_valid(v_tv, 'patient', '{}'::jsonb);
  v_code := nullif(btrim(coalesce(p_patient_code, '')), '');
  if v_code is null then
    v_code := public.allocate_patient_code(p_base_id);
  end if;
  insert into public.patient_identity (base_id, patient_code, full_name, date_of_birth, phone, address, external_identifier, created_by)
  values (p_base_id, v_code, btrim(p_full_name), p_date_of_birth, p_phone, p_address, p_external_identifier, auth.uid());
  insert into public.patient (base_id, patient_code, template_version_id, data, collection_mode, validation_status, created_by)
  values (p_base_id, v_code, v_tv, '{}'::jsonb, 'assisted', 'draft', auth.uid()) returning * into v_patient;
  v_case_code := 'CASE-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
  insert into public.raw_submission (base_id, target_patient_id, template_version_id, scope, case_code, status, submitted_by)
  values (p_base_id, v_patient.id, v_tv, 'patient', v_case_code, 'received', auth.uid()) returning id into v_submission;
  insert into public.curation_task (base_id, submission_id, status, created_by)
  values (p_base_id, v_submission, 'preparing', auth.uid()) returning * into v_task;
  insert into public.patient_curation_idempotency (user_id, idempotency_key, request_fingerprint, patient_id, submission_id, task_id)
  values (auth.uid(), btrim(p_idempotency_key), v_fingerprint, v_patient.id, v_submission, v_task.id);
  return query select v_patient.id, v_patient.patient_code, v_submission, v_task.id, false;
end $$;

revoke all on function public.create_patient_curation_submission(uuid, text, text, date, text, text, text, text) from public, anon;
grant execute on function public.create_patient_curation_submission(uuid, text, text, date, text, text, text, text) to authenticated;

-- Le rejeu hors-ligne reste un chemin legacy explicite : contrairement aux trois
-- parcours en ligne ci-dessus, une file locale doit porter son code avant l'envoi.
-- Sans cette garde, le nouveau create_patient(NULL, ...) ferait evoluer par
-- inadvertance le contrat hors-ligne vers une allocation a posteriori.
create or replace function public.replay_patient_create(
  p_operation_id        text,
  p_base_id             uuid,
  p_patient_code        text,
  p_full_name           text,
  p_date_of_birth       date,
  p_phone               text,
  p_address             text,
  p_external_identifier text,
  p_permanent_data      jsonb
)
returns table(id uuid, patient_code text, replayed boolean)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_operation public.offline_patient_create_operation;
  v_payload jsonb;
  v_fingerprint text;
  v_base uuid;
  v_patient public.patient;
begin
  if v_uid is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = 'P0001';
  end if;
  if p_operation_id is null
     or length(btrim(p_operation_id)) not between 1 and 200 then
    raise exception 'OFFLINE_OPERATION_INVALID' using errcode = 'P0001';
  end if;
  if p_base_id is null then
    raise exception 'OFFLINE_OPERATION_INVALID' using errcode = 'P0001';
  end if;
  if p_patient_code is null or btrim(p_patient_code) = '' then
    raise exception 'Code patient requis';
  end if;

  v_payload := jsonb_build_object(
    'kind', 'patient_create',
    'base_id', p_base_id,
    'patient_code', btrim(coalesce(p_patient_code, '')),
    'full_name', p_full_name,
    'date_of_birth', p_date_of_birth,
    'phone', p_phone,
    'address', p_address,
    'external_identifier', p_external_identifier,
    'permanent_data', coalesce(p_permanent_data, '{}'::jsonb)
  );
  v_fingerprint := encode(
    digest(convert_to(v_payload::text, 'UTF8'), 'sha256'),
    'hex'
  );

  perform pg_advisory_xact_lock(
    hashtextextended(v_uid::text || ':p:' || btrim(p_operation_id), 0)
  );

  select operation.* into v_operation
    from public.offline_patient_create_operation operation
   where operation.user_id = v_uid
     and operation.operation_id = btrim(p_operation_id)
   for update;
  if found then
    if v_operation.request_fingerprint is distinct from v_fingerprint then
      raise exception 'OFFLINE_OPERATION_MISMATCH' using errcode = 'P0001';
    end if;
    if v_operation.completed_at is null or v_operation.patient_id is null then
      raise exception 'OFFLINE_OPERATION_INCOMPLETE' using errcode = 'P0001';
    end if;
    return query select v_operation.patient_id, v_operation.result_patient_code, true;
    return;
  end if;

  select b.id into v_base
    from public.base b
   where b.id = p_base_id
     and b.deleted_at is null
   for update;
  if v_base is null then
    raise exception 'RESOURCE_NOT_FOUND' using errcode = 'P0001';
  end if;

  if coalesce(btrim(p_full_name), '') <> '' and p_date_of_birth is not null then
    if exists (
      select 1
        from public.patient_identity pi
       where pi.base_id = p_base_id
         and pi.deleted_at is null
         and btrim(pi.patient_code) is distinct from btrim(coalesce(p_patient_code, ''))
         and pi.full_name is not null
         and btrim(pi.full_name) = btrim(p_full_name)
         and pi.date_of_birth = p_date_of_birth
    ) then
      raise exception 'OFFLINE_IDENTITY_DUPLICATE' using errcode = 'P0001';
    end if;
  end if;

  insert into public.offline_patient_create_operation(
    user_id, operation_id, base_id, request_fingerprint
  ) values (
    v_uid, btrim(p_operation_id), p_base_id, v_fingerprint
  );

  select * into v_patient
    from public.create_patient(
      p_base_id,
      p_patient_code,
      p_full_name,
      p_date_of_birth,
      p_phone,
      p_address,
      p_external_identifier,
      p_permanent_data
    );

  update public.offline_patient_create_operation operation
     set patient_id = v_patient.id,
         result_patient_code = v_patient.patient_code,
         completed_at = now()
   where operation.user_id = v_uid
     and operation.operation_id = btrim(p_operation_id);

  return query select v_patient.id, v_patient.patient_code, false;
end
$$;

revoke all on function public.replay_patient_create(text, uuid, text, text, date, text, text, text, jsonb) from public, anon;
grant execute on function public.replay_patient_create(text, uuid, text, text, date, text, text, text, jsonb) to authenticated;

-- Un brouillon peut avoir ete sauvegarde avant cette migration avec un code
-- client. Le commit ignore ce champ et passe NULL a create_patient afin que la
-- creation finale soit toujours arbitree par la base.
create or replace function public.commit_work_draft(p_id uuid, p_expected_revision bigint, p_operation_id uuid, p_identity jsonb default null)
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
    select * into v_patient from public.create_patient(v_d.base_id, null,
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

commit;
