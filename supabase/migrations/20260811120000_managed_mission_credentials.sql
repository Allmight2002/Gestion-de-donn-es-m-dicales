-- =============================================================================
-- 20260811120000_managed_mission_credentials.sql
-- Comptes de mission geres par le proprietaire de la base (lot L15).
--
-- Le courriel personnel et l'invitation sont remplaces par :
--   * un identifiant choisi par le proprietaire ;
--   * un mot de passe genere par l'Edge Function et conserve uniquement chiffre ;
--   * une generation de justificatifs incluse dans le JWT, verifiee par la base ;
--   * des operations idempotentes et auditables pour creation/regeneration ;
--   * une revocation qui ferme l'acces et supprime les sessions Auth persistantes.
--
-- La cle de chiffrement ne vit jamais en base : seul le runtime Edge la detient.
-- Les tables ci-dessous n'accordent aucun acces direct a authenticated/anon.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Coffre chiffre et registre d'idempotence
-- -----------------------------------------------------------------------------

create table public.mission_account_credential (
  user_id                uuid primary key,
  base_id                uuid not null references public.base(id) on delete cascade,
  owner_user_id          uuid not null references public.profiles(id),
  account_label          text not null,
  login_identifier       text not null,
  password_ciphertext    text not null,
  password_nonce         text not null,
  credential_generation integer not null default 1 check (credential_generation > 0),
  status                 text not null default 'provisioning'
                         check (status in ('provisioning', 'active', 'revoked')),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  last_rotated_at        timestamptz not null default now(),
  check (char_length(account_label) between 1 and 120),
  check (login_identifier = lower(login_identifier)),
  check (login_identifier ~ '^[a-z0-9](?:[a-z0-9.-]{1,46}[a-z0-9])?$'),
  check (char_length(password_ciphertext) between 16 and 4096),
  check (char_length(password_nonce) between 12 and 256)
);

create unique index mission_account_credential_identifier_uq
  on public.mission_account_credential (lower(login_identifier));
create unique index mission_account_credential_base_user_uq
  on public.mission_account_credential (base_id, user_id);
create index mission_account_credential_owner_idx
  on public.mission_account_credential (owner_user_id, base_id, created_at desc);

comment on table public.mission_account_credential is
  'Coffre des comptes de mission. Le mot de passe est chiffre par l Edge avec une cle absente de PostgreSQL.';
comment on column public.mission_account_credential.login_identifier is
  'Identifiant metier choisi par le proprietaire, unique sans distinction de casse.';
comment on column public.mission_account_credential.credential_generation is
  'Generation comparee au JWT : toute regeneration invalide immediatement les anciens jetons pour la RLS.';

create table public.mission_credential_operation (
  operation_id        uuid primary key,
  actor_id            uuid not null references public.profiles(id),
  action              text not null check (action in ('create', 'regenerate')),
  base_id             uuid not null references public.base(id) on delete cascade,
  user_id             uuid not null,
  request_fingerprint text not null,
  result_generation   integer not null check (result_generation > 0),
  status              text not null default 'pending' check (status in ('pending', 'completed')),
  created_at          timestamptz not null default now(),
  completed_at        timestamptz
);

create index mission_credential_operation_actor_idx
  on public.mission_credential_operation (actor_id, created_at desc);

alter table public.mission_account_credential enable row level security;
alter table public.mission_credential_operation enable row level security;
revoke all on table public.mission_account_credential from public, anon, authenticated;
revoke all on table public.mission_credential_operation from public, anon, authenticated;
grant select, insert, update, delete on table public.mission_account_credential to service_role;
grant select, insert, update, delete on table public.mission_credential_operation to service_role;

-- -----------------------------------------------------------------------------
-- 2. Generation de session : les comptes historiques sans coffre echouent fermes
-- -----------------------------------------------------------------------------

create or replace function public.is_authenticated_session_current()
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        p.global_role <> 'saisisseur'
        or exists (
          select 1
          from public.mission_account_credential c
          where c.user_id = p.id
            and c.status = 'active'
            and coalesce(auth.jwt() -> 'app_metadata' ->> 'mission_credential_generation', '') ~ '^[0-9]+$'
            and (auth.jwt() -> 'app_metadata' ->> 'mission_credential_generation')::integer
                = c.credential_generation
        )
      )
  )
$$;

create or replace function public.is_saisisseur()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_authenticated_session_current()
     and exists (
       select 1 from public.profiles p
       where p.id = auth.uid() and p.global_role = 'saisisseur'
     )
$$;

-- Les anciennes sessions de mission ne doivent meme plus lire/modifier leur profil.
drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self on public.profiles for select to authenticated
  using (id = auth.uid() and public.is_authenticated_session_current());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid() and public.is_authenticated_session_current())
  with check (id = auth.uid() and public.is_authenticated_session_current());

-- -----------------------------------------------------------------------------
-- 3. Demarrage idempotent d'une creation
-- -----------------------------------------------------------------------------

create or replace function public.begin_mission_account_creation(
  p_operation_id        uuid,
  p_actor_id            uuid,
  p_base_id             uuid,
  p_user_id             uuid,
  p_account_label       text,
  p_login_identifier    text,
  p_password_ciphertext text,
  p_password_nonce      text,
  p_request_fingerprint text
) returns table (
  user_id uuid,
  base_id uuid,
  account_label text,
  login_identifier text,
  password_ciphertext text,
  password_nonce text,
  credential_generation integer,
  operation_status text
)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_operation public.mission_credential_operation;
  v_identifier text := lower(btrim(coalesce(p_login_identifier, '')));
  v_label text := btrim(coalesce(p_account_label, ''));
  v_credential public.mission_account_credential;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Appel serveur requis'; end if;
  if p_operation_id is null or p_actor_id is null or p_user_id is null then
    raise exception 'Operation invalide';
  end if;
  if p_base_id is null or not exists (
    select 1 from public.base b
     where b.id = p_base_id and b.owner_user_id = p_actor_id and b.deleted_at is null
  ) then
    raise exception 'Reserve au proprietaire de la base';
  end if;
  if char_length(v_label) not between 1 and 120 then raise exception 'Nom du compte invalide'; end if;
  if v_identifier !~ '^[a-z0-9](?:[a-z0-9.-]{1,46}[a-z0-9])?$' then
    raise exception 'Identifiant invalide';
  end if;
  if coalesce(p_password_ciphertext, '') = '' or coalesce(p_password_nonce, '') = '' then
    raise exception 'Justificatif chiffre requis';
  end if;
  if char_length(coalesce(p_request_fingerprint, '')) <> 64 then raise exception 'Empreinte invalide'; end if;

  perform pg_advisory_xact_lock(hashtextextended('mission-operation:' || p_operation_id::text, 0));
  select * into v_operation
    from public.mission_credential_operation
   where operation_id = p_operation_id
   for update;

  if found then
    if v_operation.actor_id <> p_actor_id
       or v_operation.action <> 'create'
       or v_operation.request_fingerprint <> p_request_fingerprint then
      raise exception 'Conflit d idempotence';
    end if;
    select * into strict v_credential
      from public.mission_account_credential c
     where c.user_id = v_operation.user_id
       and c.credential_generation = v_operation.result_generation;
    return query select v_credential.user_id, v_credential.base_id, v_credential.account_label,
      v_credential.login_identifier, v_credential.password_ciphertext, v_credential.password_nonce,
      v_credential.credential_generation, v_operation.status;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('mission-identifier:' || v_identifier, 0));
  if exists (
    select 1 from public.mission_account_credential c
    where lower(c.login_identifier) = v_identifier
  ) then
    raise exception 'Identifiant deja utilise';
  end if;
  if exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'Identifiant technique deja utilise';
  end if;

  insert into public.mission_account_credential (
    user_id, base_id, owner_user_id, account_label, login_identifier,
    password_ciphertext, password_nonce, credential_generation, status
  ) values (
    p_user_id, p_base_id, p_actor_id, v_label, v_identifier,
    p_password_ciphertext, p_password_nonce, 1, 'provisioning'
  ) returning * into v_credential;

  insert into public.mission_credential_operation (
    operation_id, actor_id, action, base_id, user_id, request_fingerprint,
    result_generation, status
  ) values (
    p_operation_id, p_actor_id, 'create', p_base_id, p_user_id,
    p_request_fingerprint, 1, 'pending'
  ) returning * into v_operation;

  insert into public.audit_log (user_id, action, entity, entity_id, base_id, metadata)
  values (
    p_actor_id, 'mission_credentials_creation_requested', 'profiles', p_user_id, p_base_id,
    jsonb_build_object('operation_id', p_operation_id, 'credential_generation', 1)
  );

  return query select v_credential.user_id, v_credential.base_id, v_credential.account_label,
    v_credential.login_identifier, v_credential.password_ciphertext, v_credential.password_nonce,
    v_credential.credential_generation, v_operation.status;
end $$;

-- -----------------------------------------------------------------------------
-- 4. Demarrage idempotent d'une regeneration
-- -----------------------------------------------------------------------------

create or replace function public.begin_mission_credential_regeneration(
  p_operation_id        uuid,
  p_actor_id            uuid,
  p_access_id           uuid,
  p_password_ciphertext text,
  p_password_nonce      text,
  p_request_fingerprint text
) returns table (
  user_id uuid,
  base_id uuid,
  account_label text,
  login_identifier text,
  password_ciphertext text,
  password_nonce text,
  credential_generation integer,
  operation_status text
)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_access public.base_access;
  v_operation public.mission_credential_operation;
  v_credential public.mission_account_credential;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Appel serveur requis'; end if;
  if p_operation_id is null or p_actor_id is null or p_access_id is null then
    raise exception 'Operation invalide';
  end if;
  if coalesce(p_password_ciphertext, '') = '' or coalesce(p_password_nonce, '') = '' then
    raise exception 'Justificatif chiffre requis';
  end if;
  if char_length(coalesce(p_request_fingerprint, '')) <> 64 then raise exception 'Empreinte invalide'; end if;

  perform pg_advisory_xact_lock(hashtextextended('mission-operation:' || p_operation_id::text, 0));
  select * into v_operation
    from public.mission_credential_operation
   where operation_id = p_operation_id
   for update;

  if found then
    if v_operation.actor_id <> p_actor_id
       or v_operation.action <> 'regenerate'
       or v_operation.request_fingerprint <> p_request_fingerprint then
      raise exception 'Conflit d idempotence';
    end if;
    select * into strict v_credential
      from public.mission_account_credential c
     where c.user_id = v_operation.user_id
       and c.credential_generation = v_operation.result_generation;
    return query select v_credential.user_id, v_credential.base_id, v_credential.account_label,
      v_credential.login_identifier, v_credential.password_ciphertext, v_credential.password_nonce,
      v_credential.credential_generation, v_operation.status;
    return;
  end if;

  select * into v_access from public.base_access where id = p_access_id for update;
  if not found then raise exception 'Acces introuvable'; end if;
  if not exists (
    select 1 from public.base b
     where b.id = v_access.base_id and b.owner_user_id = p_actor_id and b.deleted_at is null
  ) then
    raise exception 'Reserve au proprietaire de la base';
  end if;
  if v_access.revoked_at is not null then raise exception 'Compte de mission revoque'; end if;

  select * into v_credential
    from public.mission_account_credential c
   where c.user_id = v_access.user_id and c.base_id = v_access.base_id
   for update;
  if not found or v_credential.status = 'revoked' then
    raise exception 'Justificatifs de mission introuvables';
  end if;

  update public.mission_account_credential as c
     set password_ciphertext = p_password_ciphertext,
         password_nonce = p_password_nonce,
         credential_generation = c.credential_generation + 1,
         status = 'active',
         updated_at = now(),
         last_rotated_at = now()
   where c.user_id = v_credential.user_id
  returning c.* into v_credential;

  insert into public.mission_credential_operation (
    operation_id, actor_id, action, base_id, user_id, request_fingerprint,
    result_generation, status
  ) values (
    p_operation_id, p_actor_id, 'regenerate', v_access.base_id, v_access.user_id,
    p_request_fingerprint, v_credential.credential_generation, 'pending'
  ) returning * into v_operation;

  -- Supprime refresh tokens/sessions. Les JWT d'acces deja emis sont bloques par
  -- credential_generation dans is_saisisseur(), sans attendre leur expiration.
  delete from auth.sessions s where s.user_id = v_access.user_id;

  insert into public.audit_log (user_id, action, entity, entity_id, base_id, metadata)
  values (
    p_actor_id, 'mission_credentials_regeneration_requested', 'profiles', v_access.user_id, v_access.base_id,
    jsonb_build_object(
      'operation_id', p_operation_id,
      'credential_generation', v_credential.credential_generation
    )
  );

  return query select v_credential.user_id, v_credential.base_id, v_credential.account_label,
    v_credential.login_identifier, v_credential.password_ciphertext, v_credential.password_nonce,
    v_credential.credential_generation, v_operation.status;
end $$;

-- Appelee par l Edge avec service_role et l acteur proprietaire explicite apres Auth/provisionnement.
create or replace function public.complete_mission_credential_operation(
  p_operation_id uuid,
  p_actor_id uuid
)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_operation public.mission_credential_operation;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Appel serveur requis'; end if;
  select * into v_operation
    from public.mission_credential_operation
   where operation_id = p_operation_id
   for update;
  if not found or p_actor_id is null or v_operation.actor_id <> p_actor_id then
    raise exception 'Operation introuvable';
  end if;
  if not exists (
    select 1 from public.base b
     where b.id = v_operation.base_id and b.owner_user_id = p_actor_id and b.deleted_at is null
  ) then
    raise exception 'Reserve au proprietaire de la base';
  end if;

  update public.mission_account_credential
     set status = 'active', updated_at = now()
   where user_id = v_operation.user_id
     and credential_generation = v_operation.result_generation;
  if not found then raise exception 'Generation de justificatifs remplacee'; end if;

  if v_operation.status <> 'completed' then
    update public.mission_credential_operation
       set status = 'completed', completed_at = now()
     where operation_id = p_operation_id;
    insert into public.audit_log (user_id, action, entity, entity_id, base_id, metadata)
    values (
      p_actor_id,
      case when v_operation.action = 'create'
        then 'mission_credentials_created'
        else 'mission_credentials_regenerated'
      end,
      'profiles', v_operation.user_id, v_operation.base_id,
      jsonb_build_object(
        'operation_id', p_operation_id,
        'credential_generation', v_operation.result_generation
      )
    );
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 5. Lecture auditee du coffre, liste globale et cycle de vie
-- -----------------------------------------------------------------------------

create or replace function public.mission_credential_envelope(p_access_id uuid)
returns table (
  user_id uuid,
  base_id uuid,
  login_identifier text,
  password_ciphertext text,
  password_nonce text,
  credential_generation integer
)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_access public.base_access;
  v_credential public.mission_account_credential;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  select * into v_access from public.base_access where id = p_access_id;
  if not found or not public.is_base_owner(v_access.base_id) then
    raise exception 'Reserve au proprietaire de la base';
  end if;
  if v_access.revoked_at is not null then
    raise exception 'Compte de mission inactif';
  end if;
  select * into v_credential
    from public.mission_account_credential c
   where c.user_id = v_access.user_id
     and c.base_id = v_access.base_id
     and c.status = 'active';
  if not found then raise exception 'Justificatifs indisponibles'; end if;

  perform public.log_audit(
    'mission_credentials_revealed', 'profiles', v_access.user_id, v_access.base_id,
    jsonb_build_object('credential_generation', v_credential.credential_generation)
  );
  return query select v_credential.user_id, v_credential.base_id, v_credential.login_identifier,
    v_credential.password_ciphertext, v_credential.password_nonce,
    v_credential.credential_generation;
end $$;

create or replace function public.mission_accounts_owned(p_base_id uuid default null)
returns table (
  access_id uuid,
  base_id uuid,
  base_name text,
  user_id uuid,
  account_label text,
  login_identifier text,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz,
  can_view_identity boolean,
  identity_justification text,
  credential_status text,
  credential_generation integer,
  last_rotated_at timestamptz
)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  if not public.is_medecin() then raise exception 'Reserve aux medecins'; end if;
  if p_base_id is not null and not public.is_base_owner(p_base_id) then
    raise exception 'Reserve au proprietaire de la base';
  end if;

  return query
    select a.id, a.base_id, b.name, a.user_id,
           coalesce(c.account_label, 'Compte historique a regenerer'),
           c.login_identifier,
           a.expires_at, a.revoked_at, a.created_at,
           a.can_view_identity, a.identity_justification,
           coalesce(c.status, 'legacy_disabled'),
           c.credential_generation, c.last_rotated_at
      from public.base_access a
      join public.base b on b.id = a.base_id
      join public.profiles p on p.id = a.user_id and p.global_role = 'saisisseur'
      left join public.mission_account_credential c on c.user_id = a.user_id
     where b.owner_user_id = auth.uid()
       and (p_base_id is null or a.base_id = p_base_id)
     order by b.name, a.created_at desc;
end $$;

-- Compatibilite avec l'ancien frontend pendant le deploiement : meme signature et
-- meme forme, mais plus aucun courriel personnel n'est renvoye et seul le proprietaire lit.
create or replace function public.mission_accounts(p_base_id uuid)
returns table (
  access_id uuid,
  user_id uuid,
  email text,
  full_name text,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz,
  can_view_identity boolean,
  identity_justification text,
  activated boolean
)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  if not public.is_base_owner(p_base_id) then raise exception 'Reserve au proprietaire de la base'; end if;
  return query
    select a.id, a.user_id, c.login_identifier, coalesce(c.account_label, p.full_name),
           a.expires_at, a.revoked_at, a.created_at,
           a.can_view_identity, a.identity_justification,
           (c.status = 'active')
      from public.base_access a
      join public.profiles p on p.id = a.user_id and p.global_role = 'saisisseur'
      left join public.mission_account_credential c on c.user_id = a.user_id
     where a.base_id = p_base_id
     order by a.created_at desc;
end $$;

create or replace function public.revoke_mission_access(p_access_id uuid)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_access public.base_access;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  select * into v_access from public.base_access where id = p_access_id for update;
  if not found then raise exception 'Acces introuvable'; end if;
  if not public.is_base_owner(v_access.base_id) then
    raise exception 'Reserve au proprietaire de la base';
  end if;
  if not exists (
    select 1 from public.profiles p where p.id = v_access.user_id and p.global_role = 'saisisseur'
  ) then raise exception 'Compte de mission attendu'; end if;

  update public.base_access set revoked_at = coalesce(revoked_at, now()) where id = p_access_id;
  update public.mission_account_credential
     set status = 'revoked', updated_at = now()
   where user_id = v_access.user_id;
  delete from auth.sessions where user_id = v_access.user_id;

  perform public.log_audit(
    'mission_revoked', 'base_access', p_access_id, v_access.base_id,
    jsonb_build_object('user_id', v_access.user_id)
  );
  return v_access.user_id;
end $$;

-- Prolongation reservee au proprietaire pour le nouveau modele de responsabilite.
create or replace function public.extend_mission_access(
  p_access_id uuid,
  p_expires_at timestamptz
) returns public.base_access
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  acc public.base_access;
  v_result public.base_access;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  select * into acc from public.base_access where id = p_access_id for update;
  if not found then raise exception 'Acces introuvable'; end if;
  if not public.is_base_owner(acc.base_id) then raise exception 'Reserve au proprietaire de la base'; end if;
  if not exists (
    select 1 from public.profiles p where p.id = acc.user_id and p.global_role = 'saisisseur'
  ) then raise exception 'Compte de mission attendu'; end if;
  if p_expires_at is null or p_expires_at <= now() then raise exception 'Echeance de mission invalide'; end if;
  if p_expires_at > now() + interval '24 months' then
    raise exception 'La duree d une mission ne peut depasser 24 mois';
  end if;
  if acc.revoked_at is not null then raise exception 'Acces revoque'; end if;

  update public.base_access set expires_at = p_expires_at
   where id = p_access_id returning * into v_result;
  perform public.log_audit(
    'mission_extended', 'base_access', p_access_id, acc.base_id,
    jsonb_build_object('user_id', acc.user_id, 'from', acc.expires_at, 'to', p_expires_at)
  );
  return v_result;
end $$;

-- Provisionnement lui aussi reserve au proprietaire. L'Edge l'appelle avec son JWT.
create or replace function public.provision_mission_access(
  p_base_id uuid,
  p_user_id uuid,
  p_expires_at timestamptz,
  p_can_view_identity boolean default false,
  p_identity_justification text default null
) returns public.base_access
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_role text;
  v_result public.base_access;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  if not public.is_base_owner(p_base_id) then raise exception 'Reserve au proprietaire de la base'; end if;
  select p.global_role into v_role from public.profiles p where p.id = p_user_id;
  if v_role is distinct from 'saisisseur' then raise exception 'Compte de mission attendu'; end if;
  if p_expires_at is null or p_expires_at <= now() then raise exception 'Echeance de mission invalide'; end if;
  if p_expires_at > now() + interval '24 months' then
    raise exception 'La duree d une mission ne peut depasser 24 mois';
  end if;
  if coalesce(p_can_view_identity, false)
     and coalesce(btrim(p_identity_justification), '') = '' then
    raise exception 'Justification requise pour ouvrir l identite a un compte de mission';
  end if;

  insert into public.base_access (
    base_id, user_id, access_role,
    can_view_identity, can_view_raw_documents, can_edit_structured_data,
    can_export_data, can_manage_access, can_create_structured_data,
    expires_at, identity_justification, granted_by
  ) values (
    p_base_id, p_user_id, 'editor',
    coalesce(p_can_view_identity, false), false, false,
    false, false, true,
    p_expires_at, nullif(btrim(coalesce(p_identity_justification, '')), ''), auth.uid()
  )
  on conflict (base_id, user_id) do update set
    access_role = 'editor',
    can_view_identity = excluded.can_view_identity,
    can_view_raw_documents = false,
    can_edit_structured_data = false,
    can_export_data = false,
    can_manage_access = false,
    can_create_structured_data = true,
    expires_at = excluded.expires_at,
    identity_justification = excluded.identity_justification,
    granted_by = excluded.granted_by,
    revoked_at = null
  returning * into v_result;

  perform public.log_audit(
    'mission_granted', 'base_access', v_result.id, p_base_id,
    jsonb_build_object(
      'user_id', p_user_id,
      'expires_at', p_expires_at,
      'can_view_identity', coalesce(p_can_view_identity, false)
    )
  );
  return v_result;
end $$;

-- -----------------------------------------------------------------------------
-- 6. Privileges explicites
-- -----------------------------------------------------------------------------

revoke all on function public.is_authenticated_session_current() from public, anon;
grant execute on function public.is_authenticated_session_current() to authenticated;

revoke all on function public.begin_mission_account_creation(uuid, uuid, uuid, uuid, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.begin_mission_account_creation(uuid, uuid, uuid, uuid, text, text, text, text, text)
  to service_role;

revoke all on function public.begin_mission_credential_regeneration(uuid, uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.begin_mission_credential_regeneration(uuid, uuid, uuid, text, text, text)
  to service_role;

revoke all on function public.complete_mission_credential_operation(uuid, uuid) from public, anon, authenticated;
grant execute on function public.complete_mission_credential_operation(uuid, uuid) to service_role;

revoke all on function public.mission_credential_envelope(uuid) from public, anon;
grant execute on function public.mission_credential_envelope(uuid) to authenticated;

revoke all on function public.mission_accounts_owned(uuid) from public, anon;
grant execute on function public.mission_accounts_owned(uuid) to authenticated;

revoke all on function public.revoke_mission_access(uuid) from public, anon;
grant execute on function public.revoke_mission_access(uuid) to authenticated;

-- Les comptes historiques fondes sur l'e-mail deviennent inertes immediatement.
-- Aucune donnee de production n'existe actuellement ; cette clause reste additive et
-- echoue fermee si un ancien compte reapparait dans une autre cible.
update auth.users u
   set banned_until = greatest(coalesce(u.banned_until, now()), now() + interval '100 years'),
       updated_at = now()
  from public.profiles p
 where p.id = u.id
   and p.global_role = 'saisisseur'
   and not exists (
     select 1 from public.mission_account_credential c where c.user_id = u.id
   );

delete from auth.sessions s
using public.profiles p
where p.id = s.user_id and p.global_role = 'saisisseur';
