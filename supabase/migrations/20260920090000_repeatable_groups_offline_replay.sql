-- =============================================================================
-- 20260920090000_repeatable_groups_offline_replay.sql
-- L71 — groupes repetables hors-ligne (spec-groupes-repetables.md §10).
--
-- Deux changements, tous deux sur le rejeu hors-ligne ; aucune table touchee,
-- aucune donnee clinique reecrite.
--
-- 1. `replay_encounter_create` gagne `p_group_section_key` en DERNIERE position,
--    comme `create_encounter` (L66). L'empreinte reste calculee COTE SERVEUR a
--    partir des seuls parametres recus : le client ne la fournit jamais.
--    La cle de groupe n'entre dans la charge canonique que lorsqu'elle existe,
--    de sorte qu'un accuse emis AVANT ce lot garde exactement son empreinte et
--    reste rejouable sans OFFLINE_OPERATION_MISMATCH. Les deux charges restent
--    distinctes : une cle absente et une cle presente ne produisent jamais le
--    meme texte canonique.
--    La date reste obligatoire hors groupe (meme invariant que la contrainte
--    `encounter_date_required_outside_groups` du L66) et facultative dans une
--    occurrence, qui n'a pas toujours de date cliniquement definie (§4.3).
--    La validite du groupe (bloc racine, `is_repeatable`, borne de 50) reste
--    controlee par `create_encounter` et le declencheur d'occurrence : ce rejeu
--    n'ouvre aucun chemin d'ecriture que la saisie en ligne n'ouvre pas.
--
-- 2. `replay_encounter_update` cesse de refuser une occurrence. C'etait la
--    restriction posee tant que L71 n'etait pas livre ; la fusion de conflits
--    traite desormais chaque occurrence comme une rencontre, motif inchange.
--    Tout le reste du corps est celui de 20260919110000 : acces, empreinte,
--    verrou consultatif, ordre de verrouillage et accuse transactionnel.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. replay_encounter_create : parametre de groupe.
--    L'ancienne signature est supprimee pour ne pas laisser deux surcharges
--    appelables avec huit arguments (ambiguite au resolveur).
-- -----------------------------------------------------------------------------
drop function public.replay_encounter_create(text, text, uuid, text, date, text, jsonb, text);

create function public.replay_encounter_create(
  p_operation_id        text,
  p_parent_operation_id text,
  p_patient_id          uuid,
  p_encounter_type      text,
  p_encounter_date      date,
  p_validation_status   text,
  p_data                jsonb,
  p_age_unit            text default 'years',
  p_group_section_key   text default null
)
returns table(id uuid, patient_id uuid, replayed boolean)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_operation public.offline_encounter_create_operation;
  v_payload jsonb;
  v_fingerprint text;
  v_parent_key text;
  v_group_key text;
  v_parent_completed timestamptz;
  v_target_patient uuid;
  v_enc public.encounter;
begin
  if v_uid is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = 'P0001';
  end if;
  if p_operation_id is null
     or length(btrim(p_operation_id)) not between 1 and 200 then
    raise exception 'OFFLINE_OPERATION_INVALID' using errcode = 'P0001';
  end if;
  if p_encounter_type is null or btrim(p_encounter_type) = '' then
    raise exception 'OFFLINE_OPERATION_INVALID' using errcode = 'P0001';
  end if;

  v_group_key := nullif(btrim(coalesce(p_group_section_key, '')), '');
  -- Une vraie rencontre reste datee obligatoirement ; seule une occurrence de
  -- groupe peut ne pas l'etre (§4.3).
  if p_encounter_date is null and v_group_key is null then
    raise exception 'OFFLINE_OPERATION_INVALID' using errcode = 'P0001';
  end if;

  v_parent_key := nullif(btrim(coalesce(p_parent_operation_id, '')), '');
  if v_parent_key is not null then
    select parent.patient_id, parent.completed_at
      into v_target_patient, v_parent_completed
      from public.offline_patient_create_operation parent
     where parent.user_id = v_uid
       and parent.operation_id = v_parent_key;
    if not found then
      raise exception 'OFFLINE_PARENT_NOT_SYNCED' using errcode = 'P0001';
    end if;
    if v_target_patient is null or v_parent_completed is null then
      raise exception 'OFFLINE_PARENT_NOT_SYNCED' using errcode = 'P0001';
    end if;
  elsif p_patient_id is not null then
    select patient.id into v_target_patient
      from public.patient
     where patient.id = p_patient_id
       and patient.deleted_at is null;
    if v_target_patient is null then
      raise exception 'RESOURCE_NOT_FOUND' using errcode = 'P0001';
    end if;
  else
    raise exception 'OFFLINE_OPERATION_INVALID' using errcode = 'P0001';
  end if;

  -- Empreinte sur la charge TELLE QUE TRANSMISE : la cle parent (jamais l'UUID
  -- resolu) reste partie de la charge pour un patient en attente -> stable.
  v_payload := jsonb_build_object(
    'kind', 'encounter_create',
    'parent_operation_id', v_parent_key,
    'patient_id', case when v_parent_key is not null then null else p_patient_id end,
    'encounter_type', btrim(p_encounter_type),
    'encounter_date', p_encounter_date,
    'validation_status', p_validation_status,
    'data', coalesce(p_data, '{}'::jsonb),
    'age_unit', coalesce(p_age_unit, 'years')
  );
  if v_group_key is not null then
    v_payload := v_payload || jsonb_build_object('group_section_key', v_group_key);
  end if;
  v_fingerprint := encode(
    digest(convert_to(v_payload::text, 'UTF8'), 'sha256'),
    'hex'
  );

  perform pg_advisory_xact_lock(
    hashtextextended(v_uid::text || ':e:' || btrim(p_operation_id), 0)
  );

  select operation.* into v_operation
    from public.offline_encounter_create_operation operation
   where operation.user_id = v_uid
     and operation.operation_id = btrim(p_operation_id)
   for update;
  if found then
    if v_operation.request_fingerprint is distinct from v_fingerprint then
      raise exception 'OFFLINE_OPERATION_MISMATCH' using errcode = 'P0001';
    end if;
    if v_operation.completed_at is null or v_operation.encounter_id is null then
      raise exception 'OFFLINE_OPERATION_INCOMPLETE' using errcode = 'P0001';
    end if;
    return query select v_operation.encounter_id, v_target_patient, true;
    return;
  end if;

  insert into public.offline_encounter_create_operation(
    user_id, operation_id, parent_operation_id, request_fingerprint, patient_id
  ) values (
    v_uid, btrim(p_operation_id), v_parent_key, v_fingerprint, v_target_patient
  );

  select * into v_enc
    from public.create_encounter(
      v_target_patient,
      btrim(p_encounter_type),
      p_encounter_date,
      p_validation_status,
      p_data,
      coalesce(p_age_unit, 'years'),
      v_group_key
    );

  update public.offline_encounter_create_operation operation
     set encounter_id = v_enc.id,
         completed_at = now()
   where operation.user_id = v_uid
     and operation.operation_id = btrim(p_operation_id);

  return query select v_enc.id, v_enc.patient_id, false;
end
$$;

revoke all on function public.replay_encounter_create(
  text, text, uuid, text, date, text, jsonb, text, text
) from public, anon, authenticated;
grant execute on function public.replay_encounter_create(
  text, text, uuid, text, date, text, jsonb, text, text
) to authenticated;

-- -----------------------------------------------------------------------------
-- 2. replay_encounter_update : une occurrence redevient une rencontre ordinaire
--    pour le rejeu et la resolution de conflit. Seul le refus de groupe tombe.
-- -----------------------------------------------------------------------------
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
  v_base_id uuid;
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

  -- Preserve the serialization order: lock the encounter before inserting the receipt.
  select encounter.* into v_encounter
    from public.encounter encounter
   where encounter.id = p_encounter_id
     and encounter.deleted_at is null
   for update;
  if not found then
    raise exception 'RESOURCE_NOT_FOUND' using errcode = 'P0001';
  end if;

  select patient.base_id into v_base_id
    from public.patient patient
   where patient.id = v_encounter.patient_id;
  perform public.form_record_assert_write_access(
    v_base_id, v_encounter.created_by, v_encounter.validation_status, p_validation_status
  );

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
