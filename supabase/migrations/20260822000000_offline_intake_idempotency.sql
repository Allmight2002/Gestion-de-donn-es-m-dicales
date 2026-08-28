-- =============================================================================
-- 20260822000000_offline_intake_idempotency.sql
-- Feuille de route « saisie hors-ligne » (lot O1) : rendre les CREATIONS
-- preparees hors-ligne rejouables sans doublon.
--
-- Modele : offline_encounter_operation + replay_encounter_update
-- (20260713195422 / 20260714040500). Une cle d'operation stable cote client,
-- un empreinte calculee COTE SERVEUR, un verrou consultatif pour serialiser
-- deux rejeux concurrents, et l'accuse + l'ecriture clinique dans LA MEME
-- transaction : un echec ne laisse aucun reçu incomplet, une reponse reseau
-- perdue retrouve son accuse au rejeu.
--
-- Tables de recu SERVER-ONLY (RLS activee, aucun grant direct) : elles ne
-- portent que l'accusé minimal (empreinte + identifiants crees).
--
-- Controles serveur explicites ajoutes :
--  * collision de code patient -> contrainte unique (23505), sans etat partiel ;
--  * doublon d'identite -> OFFLINE_IDENTITY_DUPLICATE quand le meme nom complet
--    + date de naissance existe deja dans la base sous un autre code ;
--  * base supprimee -> RESOURCE_NOT_FOUND ;
--  * rencontre dont le patient parent n'est pas encore synchronise ->
--    OFFLINE_PARENT_NOT_SYNCED (le client garde la dependance bloquee).
-- Migration ADDITIVE : aucune table ni fonction existante modifiee.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Recus de creation patient (cle = (utilisateur, operation)).
-- -----------------------------------------------------------------------------
create table if not exists public.offline_patient_create_operation (
  user_id uuid not null references public.profiles(id) on delete restrict,
  operation_id text not null check (
    length(btrim(operation_id)) between 1 and 200
  ),
  base_id uuid not null references public.base(id) on delete restrict,
  request_fingerprint text not null check (length(request_fingerprint) = 64),
  patient_id uuid references public.patient(id) on delete restrict,
  result_patient_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (user_id, operation_id)
);

alter table public.offline_patient_create_operation enable row level security;
revoke all on table public.offline_patient_create_operation from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. Recus de creation rencontre. La rencontre d'un NOUVEAU patient reference
--    la cle de l'operation parent ; une rencontre sur un patient serveur deja
--    connu porte directement patient_id.
-- -----------------------------------------------------------------------------
create table if not exists public.offline_encounter_create_operation (
  user_id uuid not null references public.profiles(id) on delete restrict,
  operation_id text not null check (
    length(btrim(operation_id)) between 1 and 200
  ),
  parent_operation_id text check (
    length(btrim(parent_operation_id)) between 1 and 200
  ),
  request_fingerprint text not null check (length(request_fingerprint) = 64),
  patient_id uuid references public.patient(id) on delete restrict,
  encounter_id uuid references public.encounter(id) on delete restrict,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (user_id, operation_id),
  constraint offline_encounter_create_target check (
    parent_operation_id is not null or patient_id is not null
  )
);

alter table public.offline_encounter_create_operation enable row level security;
revoke all on table public.offline_encounter_create_operation from public, anon, authenticated;

create index if not exists offline_encounter_create_parent_idx
  on public.offline_encounter_create_operation (user_id, parent_operation_id);

-- -----------------------------------------------------------------------------
-- 3. replay_patient_create : rejeu idempotent d'une creation patient hors-ligne.
-- -----------------------------------------------------------------------------
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

  -- Empreinte calculee COTE SERVEUR sur la charge canonique : un meme accusé
  -- ne peut couvrir deux contenus differents.
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

  -- Serialise uniquement les rejeux d'une MEME intention utilisateur.
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

  -- Verrou de base : deux creations concurrentes (cles differentes, memes
  -- utilisateurs ou non) qui visent le meme code se serialisent ici ; le perdant
  -- echoue proprement sur la contrainte unique, sans etat partiel.
  select b.id into v_base
    from public.base b
   where b.id = p_base_id
     and b.deleted_at is null
   for update;
  if v_base is null then
    raise exception 'RESOURCE_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- Doublon d'identite : controle explicite serveur (le client hors-ligne ne
  -- peut pas decider seul depuis une recherche ancienne). Seule l'identite
  -- reellement ecrite (can_write_identity) participe au rapprochement.
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

  -- Creation finale via la RPC existante (validation, droits, triggers) dans
  -- LA MEME transaction : tout echec annule aussi le recu.
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

-- -----------------------------------------------------------------------------
-- 4. replay_encounter_create : rejeu idempotent d'une creation rencontre.
--    La rencontre d'un patient EN ATTENTE ne part qu'apres la creation confirmee
--    du parent (dependance ordonnee, invariant §4 de la feuille de route).
-- -----------------------------------------------------------------------------
create or replace function public.replay_encounter_create(
  p_operation_id       text,
  p_parent_operation_id text,
  p_patient_id         uuid,
  p_encounter_type     text,
  p_encounter_date     date,
  p_validation_status  text,
  p_data               jsonb,
  p_age_unit           text default 'years'
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
  if p_encounter_date is null then
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
      coalesce(p_age_unit, 'years')
    );

  update public.offline_encounter_create_operation operation
     set encounter_id = v_enc.id,
         completed_at = now()
   where operation.user_id = v_uid
     and operation.operation_id = btrim(p_operation_id);

  return query select v_enc.id, v_enc.patient_id, false;
end
$$;

-- -----------------------------------------------------------------------------
-- 5. Privileges : execute aux authentifies uniquement, comme les autres RPC.
-- -----------------------------------------------------------------------------
revoke all on function public.replay_patient_create(
  text, uuid, text, text, date, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.replay_patient_create(
  text, uuid, text, text, date, text, text, text, jsonb
) to authenticated;

revoke all on function public.replay_encounter_create(
  text, text, uuid, text, date, text, jsonb, text
) from public, anon, authenticated;
grant execute on function public.replay_encounter_create(
  text, text, uuid, text, date, text, jsonb, text
) to authenticated;
