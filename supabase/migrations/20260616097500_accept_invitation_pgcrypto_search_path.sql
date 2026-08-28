-- 20260616097500_accept_invitation_pgcrypto_search_path.sql
-- Supabase installe souvent pgcrypto dans le schema `extensions`. La RPC
-- accept_invitation est SECURITY DEFINER avec un search_path restreint : sans
-- `extensions`, digest(p_token, 'sha256') peut echouer en production.

create or replace function public.accept_invitation(p_token text)
returns public.base_access
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
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

grant execute on function public.accept_invitation(text) to authenticated;
