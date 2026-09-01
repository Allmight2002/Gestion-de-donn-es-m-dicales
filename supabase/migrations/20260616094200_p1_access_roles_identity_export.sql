-- =============================================================================
-- 20260616094200_p1_access_roles_identity_export.sql
-- Correctifs P1 :
--   * base_access actif reserve aux comptes medecin ;
--   * roles globaux geres par admin sans auto-changement ;
--   * patient_identity n'est plus lisible en direct : lecture via RPC auditee.
-- =============================================================================

-- Un partage actif de base ne peut viser qu'un medecin. Les lignes deja revoquees
-- restent modifiables pour permettre le nettoyage d'anciens acces invalides.
create or replace function public.guard_base_access_medecin()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.revoked_at is null and not exists (
    select 1 from public.profiles p
    where p.id = new.user_id and p.global_role = 'medecin'
  ) then
    raise exception 'base_access reserve aux comptes medecin';
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_base_access_medecin on public.base_access;
create trigger trg_guard_base_access_medecin
  before insert or update on public.base_access
  for each row execute function public.guard_base_access_medecin();

-- Defense en profondeur : meme si une ancienne ligne base_access non medecin existe,
-- les helpers RLS refusent tout acces patient a un compte global non-medecin.
create or replace function public.has_base_access(p_base uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_medecin() and (
    exists (select 1 from public.base b where b.id = p_base and b.owner_user_id = auth.uid())
    or exists (select 1 from public.base_access a
               where a.base_id = p_base and a.user_id = auth.uid() and a.revoked_at is null)
  )
$$;

create or replace function public.can_view_identity(p_base uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_medecin() and (
    public.is_base_owner(p_base)
    or exists (select 1 from public.base_access a
               where a.base_id = p_base and a.user_id = auth.uid() and a.revoked_at is null and a.can_view_identity)
  )
$$;

create or replace function public.can_view_raw_documents(p_base uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_medecin() and (
    public.is_base_owner(p_base)
    or exists (select 1 from public.base_access a
               where a.base_id = p_base and a.user_id = auth.uid() and a.revoked_at is null and a.can_view_raw_documents)
  )
$$;

create or replace function public.can_edit_structured_data(p_base uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_medecin() and (
    public.is_base_owner(p_base)
    or exists (select 1 from public.base_access a
               where a.base_id = p_base and a.user_id = auth.uid() and a.revoked_at is null and a.can_edit_structured_data)
  )
$$;

create or replace function public.can_export_data(p_base uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_medecin() and (
    public.is_base_owner(p_base)
    or exists (select 1 from public.base_access a
               where a.base_id = p_base and a.user_id = auth.uid() and a.revoked_at is null and a.can_export_data)
  )
$$;

create or replace function public.can_manage_access(p_base uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_medecin() and (
    public.is_base_owner(p_base)
    or exists (select 1 from public.base_access a
               where a.base_id = p_base and a.user_id = auth.uid() and a.revoked_at is null and a.can_manage_access)
  )
$$;

create or replace function public.can_write_identity(p_base uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_medecin() and (
    public.is_base_owner(p_base)
    or exists (select 1 from public.base_access a
               where a.base_id = p_base and a.user_id = auth.uid() and a.revoked_at is null
                 and a.can_view_identity and a.can_edit_structured_data)
  )
$$;

create or replace function public.can_curate(p_base uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_medecin() and (
    public.is_base_owner(p_base)
    or exists (select 1 from public.base_access a
               where a.base_id = p_base and a.user_id = auth.uid() and a.revoked_at is null
                 and (a.can_edit_structured_data or a.can_export_data))
  )
$$;

drop policy if exists base_select on public.base;
create policy base_select on public.base for select to authenticated using (
  deleted_at is null
  and public.is_medecin()
  and (
    owner_user_id = auth.uid()
    or exists (
      select 1 from public.base_access ba
      where ba.base_id = base.id and ba.user_id = auth.uid() and ba.revoked_at is null
    )
  )
);

-- Acceptation d'invitation : verification explicite du role global avant l'upsert
-- base_access, en plus du trigger ci-dessus.
create or replace function public.accept_invitation(p_token text)
returns public.base_access
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  inv     public.base_invitation;
  v_email text;
  v_hash  text;
  result  public.base_access;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  if not public.is_medecin() then raise exception 'Invitation reservee aux comptes medecin'; end if;

  v_hash := encode(digest(p_token, 'sha256'), 'hex');
  select * into inv from public.base_invitation where token_hash = v_hash for update;
  if not found then raise exception 'Invitation introuvable'; end if;
  if inv.status <> 'pending' then raise exception 'Invitation non valable (statut=%)', inv.status; end if;
  if inv.expires_at < now() then
    update public.base_invitation set status = 'expired' where id = inv.id;
    raise exception 'Invitation expiree';
  end if;

  select email into v_email from auth.users where id = auth.uid();
  if v_email is null or lower(v_email) <> lower(inv.invited_email) then
    raise exception 'Cette invitation ne correspond pas a votre compte';
  end if;

  insert into public.base_access (
    base_id, user_id, access_role,
    can_view_identity, can_view_raw_documents, can_edit_structured_data,
    can_export_data, can_manage_access, granted_by
  )
  values (
    inv.base_id, auth.uid(), inv.access_role,
    inv.can_view_identity, inv.can_view_raw_documents, inv.can_edit_structured_data,
    inv.can_export_data, inv.can_manage_access, inv.invited_by
  )
  on conflict (base_id, user_id) do update set
    access_role              = excluded.access_role,
    can_view_identity        = excluded.can_view_identity,
    can_view_raw_documents   = excluded.can_view_raw_documents,
    can_edit_structured_data = excluded.can_edit_structured_data,
    can_export_data          = excluded.can_export_data,
    can_manage_access        = excluded.can_manage_access,
    revoked_at               = null
  returning * into result;

  update public.base_invitation set status = 'accepted' where id = inv.id;
  return result;
end $$;
grant execute on function public.accept_invitation(text) to authenticated;

-- Role global : l'admin systeme peut modifier un AUTRE profil ; personne ne modifie
-- son propre global_role. Les updates self restent possibles pour full_name/language.
create or replace function public.guard_profile_role()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and new.global_role is distinct from old.global_role then
    if new.id = auth.uid() then
      raise exception 'Modification de son propre global_role non autorisee';
    end if;
    if not public.is_system_admin() then
      raise exception 'Modification de global_role non autorisee';
    end if;
  end if;
  return new;
end $$;

drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles for update to authenticated
  using (public.is_system_admin() and id <> auth.uid())
  with check (public.is_system_admin() and id <> auth.uid());

-- Lecture directe de l'identite interdite aux clients : toute revelation doit
-- passer par une RPC SECURITY DEFINER qui audite AVANT de renvoyer les champs.
drop policy if exists pi_select on public.patient_identity;

create or replace function public.get_patient_identity(p_patient_id uuid)
returns table (
  patient_code text,
  full_name text,
  date_of_birth date,
  phone text,
  address text,
  external_identifier text
)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_base uuid;
  v_code text;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;

  select p.base_id, p.patient_code into v_base, v_code
  from public.patient p
  where p.id = p_patient_id and p.deleted_at is null;

  if v_base is null or not public.can_view_identity(v_base) then
    return;
  end if;

  insert into public.audit_log (user_id, action, entity, entity_id, base_id, metadata)
  values (auth.uid(), 'identity_read', 'patient', p_patient_id, v_base, '{}'::jsonb);

  return query
    select pi.patient_code, pi.full_name, pi.date_of_birth, pi.phone, pi.address, pi.external_identifier
    from public.patient_identity pi
    where pi.base_id = v_base and pi.patient_code = v_code and pi.deleted_at is null;
end $$;
grant execute on function public.get_patient_identity(uuid) to authenticated;

create or replace function public.find_identity_matches(
  p_base_id uuid,
  p_full_name text,
  p_date_of_birth date
)
returns table (
  patient_id uuid,
  code text,
  full_name text,
  date_of_birth date
)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record;
  v_name text;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  if not public.can_view_identity(p_base_id) then return; end if;

  v_name := btrim(coalesce(p_full_name, ''));
  if v_name = '' or p_date_of_birth is null then return; end if;

  for r in
    select p.id as patient_id, p.patient_code as code, pi.full_name, pi.date_of_birth
    from public.patient_identity pi
    join public.patient p on p.base_id = pi.base_id and p.patient_code = pi.patient_code
    where pi.base_id = p_base_id
      and pi.deleted_at is null
      and p.deleted_at is null
      and pi.date_of_birth = p_date_of_birth
      and lower(pi.full_name) = lower(v_name)
  loop
    insert into public.audit_log (user_id, action, entity, entity_id, base_id, metadata)
    values (
      auth.uid(), 'identity_read', 'patient', r.patient_id, p_base_id,
      jsonb_build_object('reason', 'identity_match')
    );

    patient_id := r.patient_id;
    code := r.code;
    full_name := r.full_name;
    date_of_birth := r.date_of_birth;
    return next;
  end loop;
end $$;
grant execute on function public.find_identity_matches(uuid, text, date) to authenticated;
