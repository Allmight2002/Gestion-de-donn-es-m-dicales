-- =============================================================================
-- 20260616095500_access_invitation_rpc_guards.sql
-- P1 audit: base_invitation/base_access writes now go through narrow RPCs.
-- Delegated managers can administer access without escalating permissions they do
-- not hold, while owners keep full control.
-- =============================================================================

drop policy if exists bi_manage on public.base_invitation;
drop policy if exists bi_select on public.base_invitation;
create policy bi_select on public.base_invitation for select to authenticated
  using (
    public.is_base_owner(base_id)
    or public.can_manage_access(base_id)
    or invited_by = auth.uid()
  );

drop policy if exists ba_manage on public.base_access;

create or replace function public.assert_access_change_allowed(
  p_base_id uuid,
  p_target_user_id uuid,
  p_new_can_view_identity boolean,
  p_new_can_view_raw_documents boolean,
  p_new_can_edit_structured_data boolean,
  p_new_can_export_data boolean,
  p_new_can_manage_access boolean,
  p_old_can_view_identity boolean default false,
  p_old_can_view_raw_documents boolean default false,
  p_old_can_edit_structured_data boolean default false,
  p_old_can_export_data boolean default false,
  p_old_can_manage_access boolean default false
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid := auth.uid();
  v_actor_access public.base_access;
begin
  if v_actor is null then raise exception 'Authentification requise'; end if;
  if not public.is_medecin() then raise exception 'Gestion des acces reservee aux medecins'; end if;

  if exists (
    select 1 from public.base b
    where b.id = p_base_id and b.owner_user_id = v_actor and b.deleted_at is null
  ) then
    return;
  end if;

  select * into v_actor_access
  from public.base_access a
  where a.base_id = p_base_id and a.user_id = v_actor and a.revoked_at is null;

  if v_actor_access.id is null or not v_actor_access.can_manage_access then
    raise exception 'Gestion des acces requise';
  end if;
  if p_target_user_id is not null and p_target_user_id = v_actor then
    raise exception 'Un delegue ne peut pas modifier sa propre ligne d''acces (anti-escalade)';
  end if;

  if coalesce(p_new_can_manage_access, false) and not coalesce(p_old_can_manage_access, false) then
    raise exception 'Seul le proprietaire de la base peut accorder la gestion des acces';
  end if;
  if coalesce(p_new_can_view_identity, false) and not coalesce(p_old_can_view_identity, false) then
    raise exception 'Seul le proprietaire de la base peut accorder l''acces a l''identite';
  end if;
  if coalesce(p_new_can_view_raw_documents, false) and not coalesce(p_old_can_view_raw_documents, false)
     and not v_actor_access.can_view_raw_documents then
    raise exception 'Permission documents non detenue : impossible a accorder';
  end if;
  if coalesce(p_new_can_edit_structured_data, false) and not coalesce(p_old_can_edit_structured_data, false)
     and not v_actor_access.can_edit_structured_data then
    raise exception 'Permission edition non detenue : impossible a accorder';
  end if;
  if coalesce(p_new_can_export_data, false) and not coalesce(p_old_can_export_data, false)
     and not v_actor_access.can_export_data then
    raise exception 'Permission export non detenue : impossible a accorder';
  end if;
end $$;

create or replace function public.invitation_permissions_still_valid(
  p_base_id uuid,
  p_actor uuid,
  p_can_view_identity boolean,
  p_can_view_raw_documents boolean,
  p_can_edit_structured_data boolean,
  p_can_export_data boolean,
  p_can_manage_access boolean
) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select p_actor is not null and (
    exists (
      select 1 from public.base b
      where b.id = p_base_id and b.owner_user_id = p_actor and b.deleted_at is null
    )
    or exists (
      select 1
      from public.base_access a
      join public.base b on b.id = a.base_id and b.deleted_at is null
      where a.base_id = p_base_id
        and a.user_id = p_actor
        and a.revoked_at is null
        and a.can_manage_access
        and not coalesce(p_can_manage_access, false)
        and not coalesce(p_can_view_identity, false)
        and (not coalesce(p_can_view_raw_documents, false) or a.can_view_raw_documents)
        and (not coalesce(p_can_edit_structured_data, false) or a.can_edit_structured_data)
        and (not coalesce(p_can_export_data, false) or a.can_export_data)
    )
  )
$$;

create or replace function public.create_base_invitation(
  p_base_id uuid,
  p_invited_email text,
  p_access_role text,
  p_can_view_identity boolean,
  p_can_view_raw_documents boolean,
  p_can_edit_structured_data boolean,
  p_can_export_data boolean,
  p_can_manage_access boolean,
  p_token_hash text,
  p_expires_at timestamptz
) returns public.base_invitation
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_email text := lower(btrim(coalesce(p_invited_email, '')));
  v_actor_email text;
  result public.base_invitation;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  if v_email = '' then raise exception 'Email invite requis'; end if;
  if p_access_role not in ('viewer', 'editor') then raise exception 'Role d''acces invalide'; end if;
  if nullif(btrim(coalesce(p_token_hash, '')), '') is null then raise exception 'Token hash requis'; end if;
  if p_expires_at <= now() then raise exception 'Expiration invalide'; end if;

  select lower(email) into v_actor_email from auth.users where id = auth.uid();
  if v_actor_email = v_email then
    raise exception 'Auto-invitation interdite';
  end if;

  perform public.assert_access_change_allowed(
    p_base_id, null,
    p_can_view_identity, p_can_view_raw_documents, p_can_edit_structured_data,
    p_can_export_data, p_can_manage_access,
    false, false, false, false, false
  );

  insert into public.base_invitation (
    base_id, invited_email, access_role,
    can_view_identity, can_view_raw_documents, can_edit_structured_data,
    can_export_data, can_manage_access, token_hash, status, expires_at, invited_by
  )
  values (
    p_base_id, v_email, p_access_role,
    coalesce(p_can_view_identity, false), coalesce(p_can_view_raw_documents, false),
    coalesce(p_can_edit_structured_data, false), coalesce(p_can_export_data, false),
    coalesce(p_can_manage_access, false), p_token_hash, 'pending', p_expires_at, auth.uid()
  )
  returning * into result;

  return result;
end $$;

create or replace function public.revoke_base_invitation(p_invitation_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  inv public.base_invitation;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  select * into inv from public.base_invitation where id = p_invitation_id for update;
  if not found then raise exception 'Invitation introuvable'; end if;
  if inv.status <> 'pending' then raise exception 'Invitation non modifiable (statut=%)', inv.status; end if;

  if public.is_base_owner(inv.base_id) then
    null;
  elsif public.can_manage_access(inv.base_id) and inv.invited_by = auth.uid() then
    null;
  else
    raise exception 'Acces refuse';
  end if;

  update public.base_invitation set status = 'revoked' where id = inv.id;
end $$;

create or replace function public.update_base_access_permissions(
  p_access_id uuid,
  p_can_view_identity boolean,
  p_can_view_raw_documents boolean,
  p_can_edit_structured_data boolean,
  p_can_export_data boolean,
  p_can_manage_access boolean
) returns public.base_access
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  acc public.base_access;
  result public.base_access;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  select * into acc from public.base_access where id = p_access_id and revoked_at is null for update;
  if not found then raise exception 'Acces introuvable'; end if;

  perform public.assert_access_change_allowed(
    acc.base_id, acc.user_id,
    p_can_view_identity, p_can_view_raw_documents, p_can_edit_structured_data,
    p_can_export_data, p_can_manage_access,
    acc.can_view_identity, acc.can_view_raw_documents, acc.can_edit_structured_data,
    acc.can_export_data, acc.can_manage_access
  );

  update public.base_access
     set can_view_identity = coalesce(p_can_view_identity, false),
         can_view_raw_documents = coalesce(p_can_view_raw_documents, false),
         can_edit_structured_data = coalesce(p_can_edit_structured_data, false),
         can_export_data = coalesce(p_can_export_data, false),
         can_manage_access = coalesce(p_can_manage_access, false),
         access_role = case when coalesce(p_can_edit_structured_data, false) then 'editor' else 'viewer' end
   where id = p_access_id
  returning * into result;

  return result;
end $$;

create or replace function public.revoke_base_access(p_access_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  acc public.base_access;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  select * into acc from public.base_access where id = p_access_id and revoked_at is null for update;
  if not found then raise exception 'Acces introuvable'; end if;

  perform public.assert_access_change_allowed(
    acc.base_id, acc.user_id,
    false, false, false, false, false,
    acc.can_view_identity, acc.can_view_raw_documents, acc.can_edit_structured_data,
    acc.can_export_data, acc.can_manage_access
  );

  update public.base_access set revoked_at = now() where id = p_access_id;
end $$;

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

  if not public.invitation_permissions_still_valid(
    inv.base_id, inv.invited_by,
    inv.can_view_identity, inv.can_view_raw_documents, inv.can_edit_structured_data,
    inv.can_export_data, inv.can_manage_access
  ) then
    raise exception 'Invitation invalidee par les permissions de son createur';
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
    granted_by               = excluded.granted_by,
    revoked_at               = null
  returning * into result;

  update public.base_invitation set status = 'accepted' where id = inv.id;
  return result;
end $$;

grant execute on function public.create_base_invitation(uuid, text, text, boolean, boolean, boolean, boolean, boolean, text, timestamptz) to authenticated;
grant execute on function public.revoke_base_invitation(uuid) to authenticated;
grant execute on function public.update_base_access_permissions(uuid, boolean, boolean, boolean, boolean, boolean) to authenticated;
grant execute on function public.revoke_base_access(uuid) to authenticated;
grant execute on function public.accept_invitation(text) to authenticated;
