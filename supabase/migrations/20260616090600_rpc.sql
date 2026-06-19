-- =============================================================================
-- 20260616090600_rpc.sql  (v3.0)
-- Acceptation d'invitation (token hache + 6 permissions) et garde-fou d'export.
-- =============================================================================

-- L'invitation stocke uniquement l'empreinte du token (§6.2). On recoit le token en
-- clair, on le hache et on cherche par token_hash. SECURITY DEFINER : l'invite n'a
-- pas encore d'acces, il ne peut donc pas inserer lui-meme dans base_access via RLS.
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
    can_validate_data, can_export_data, can_manage_access, granted_by
  )
  values (
    inv.base_id, auth.uid(), inv.access_role,
    inv.can_view_identity, inv.can_view_raw_documents, inv.can_edit_structured_data,
    inv.can_validate_data, inv.can_export_data, inv.can_manage_access, inv.invited_by
  )
  on conflict (base_id, user_id) do update set
    access_role              = excluded.access_role,
    can_view_identity        = excluded.can_view_identity,
    can_view_raw_documents   = excluded.can_view_raw_documents,
    can_edit_structured_data = excluded.can_edit_structured_data,
    can_validate_data        = excluded.can_validate_data,
    can_export_data          = excluded.can_export_data,
    can_manage_access        = excluded.can_manage_access,
    revoked_at               = null
  returning * into result;

  update public.base_invitation set status = 'accepted' where id = inv.id;
  return result;
end $$;

grant execute on function public.accept_invitation(text) to authenticated;

-- Garde-fou d'export : refuse toute colonne identifiante ou inconnue (§10.6).
create or replace function public.assert_export_columns_safe(p_template_version_id uuid, p_columns text[])
returns void language plpgsql stable set search_path = public, pg_temp as $$
declare
  c                  text;
  identity_blocklist text[] := array[
    'full_name','name','patient_name','first_name','last_name',
    'date_of_birth','dob','birth_date','phone','address','contact','email','external_identifier'
  ];
  meta_allowlist     text[] := array[
    'patient_code','encounter_id','encounter_date','encounter_type',
    'age_value','age_unit','age_group','validation_status'
  ];
begin
  foreach c in array p_columns loop
    if c = any(identity_blocklist) then
      raise exception 'Champ identifiant interdit a l''export: %', c;
    end if;
    if c = any(meta_allowlist) then continue; end if;
    if not exists (
      select 1 from public.template_field f
      where f.template_version_id = p_template_version_id and f.field_key = c
    ) then
      raise exception 'Champ inconnu ou non exportable: %', c;
    end if;
  end loop;
end $$;

grant execute on function public.assert_export_columns_safe(uuid, text[]) to authenticated;
