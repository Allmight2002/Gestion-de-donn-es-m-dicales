-- Verrou optimiste des patients et creation atomique patient + curation.
-- Migration additive : les anciennes RPC restent disponibles pour les autres parcours.

-- Le verrou patient ne laisse aucune voie sans version : un formulaire doit toujours
-- travailler a partir d'un instantane charge precedemment.
alter table public.patient
  add column row_version bigint not null default 1,
  add constraint patient_row_version_positive check (row_version > 0);

create or replace function public.bump_patient_row_version()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  new.row_version := old.row_version + 1;
  return new;
end $$;
revoke all on function public.bump_patient_row_version() from public, anon, authenticated;
create trigger trg_patient_row_version
  before update on public.patient
  for each row execute function public.bump_patient_row_version();

drop function if exists public.update_patient(uuid, jsonb, text, text);
create or replace function public.update_patient(
  p_patient_id uuid,
  p_data jsonb,
  p_validation_status text,
  p_reason text,
  p_expected_version bigint
) returns public.patient
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_pat public.patient; v_old jsonb; v_new jsonb; v_key text;
begin
  -- FOR UPDATE precede la comparaison : deux ecritures concurrentes ne peuvent pas
  -- toutes deux valider la meme version.
  select * into v_pat from public.patient
   where id = p_patient_id and deleted_at is null for update;
  if not found then raise exception 'Patient introuvable'; end if;
  if not public.can_edit_structured_data(v_pat.base_id) then raise exception 'Acces refuse'; end if;
  if p_expected_version is null then
    raise exception 'CONFLIT_VERSION : version patient requise' using errcode = 'P0001';
  end if;
  if v_pat.row_version is distinct from p_expected_version then
    raise exception 'CONFLIT_VERSION : le patient a ete modifie entre-temps' using errcode = 'P0001';
  end if;

  perform public.assert_data_valid(v_pat.template_version_id, 'patient', coalesce(p_data, '{}'::jsonb));
  v_old := v_pat.data;
  v_new := coalesce(p_data, '{}'::jsonb);
  for v_key in
    select key from (select jsonb_object_keys(v_old) as key union select jsonb_object_keys(v_new) as key) keys
  loop
    if (v_old -> v_key) is distinct from (v_new -> v_key) then
      insert into public.field_change_log (base_id, entity, entity_id, field_key, old_value, new_value, changed_by, reason, source)
      values (v_pat.base_id, 'patient', p_patient_id, v_key, v_old -> v_key, v_new -> v_key, auth.uid(), p_reason, 'manual_correction');
    end if;
  end loop;
  update public.patient set data = v_new,
    validation_status = coalesce(p_validation_status, v_pat.validation_status), updated_at = now()
    where id = p_patient_id returning * into v_pat;
  return v_pat;
end $$;
revoke all on function public.update_patient(uuid, jsonb, text, text, bigint) from public, anon;
grant execute on function public.update_patient(uuid, jsonb, text, text, bigint) to authenticated;

-- Une ligne est ecrite seulement avec le resultat final, dans la meme transaction.
-- RLS reste fermee : la table est accessible exclusivement a la RPC SECURITY DEFINER.
create table public.patient_curation_idempotency (
  user_id uuid not null references public.profiles(id),
  idempotency_key text not null check (length(btrim(idempotency_key)) between 1 and 200),
  -- Empreinte uniquement : ne pas dupliquer l'identite/DOB dans une table technique.
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  patient_id uuid not null references public.patient(id),
  submission_id uuid not null references public.raw_submission(id),
  task_id uuid not null references public.curation_task(id),
  created_at timestamptz not null default now(),
  primary key (user_id, idempotency_key)
);
alter table public.patient_curation_idempotency enable row level security;
revoke all on table public.patient_curation_idempotency from public, anon, authenticated;

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
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_existing public.patient_curation_idempotency;
  v_tv uuid; v_patient public.patient; v_submission uuid; v_task public.curation_task;
  v_payload jsonb; v_fingerprint text; v_case_code text;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then raise exception 'Cle d''idempotence requise'; end if;
  if length(btrim(p_idempotency_key)) > 200 then raise exception 'Cle d''idempotence invalide'; end if;
  -- Lot 3 : toutes les policies et RPC suivantes (documents, soumission,
  -- finalisation) restent reservees au proprietaire. Autoriser ici un editeur
  -- creerait un cas qu'il ne pourrait ensuite ni voir ni poursuivre.
  if not public.is_base_owner(p_base_id) then raise exception 'Reserve au proprietaire de la base'; end if;
  if p_patient_code is null or btrim(p_patient_code) = '' then raise exception 'Code patient requis'; end if;
  if nullif(btrim(p_full_name), '') is null or p_date_of_birth is null then raise exception 'Identite patient requise'; end if;

  v_payload := jsonb_build_object('base_id', p_base_id, 'patient_code', btrim(p_patient_code),
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

  select current_template_version_id into v_tv from public.base where id = p_base_id;
  if v_tv is null then raise exception 'La base n''a pas de version de gabarit courante'; end if;
  perform public.assert_data_valid(v_tv, 'patient', '{}'::jsonb);
  insert into public.patient_identity (base_id, patient_code, full_name, date_of_birth, phone, address, external_identifier, created_by)
  values (p_base_id, btrim(p_patient_code), btrim(p_full_name), p_date_of_birth, p_phone, p_address, p_external_identifier, auth.uid());
  insert into public.patient (base_id, patient_code, template_version_id, data, collection_mode, validation_status, created_by)
  values (p_base_id, btrim(p_patient_code), v_tv, '{}'::jsonb, 'assisted', 'draft', auth.uid()) returning * into v_patient;
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
