-- Renversement delibere de la decision du 2026-07-28 : un compte de mission
-- peut ecrire l'identite nominative si le proprietaire a explicitement accorde
-- can_view_identity. La branche medecin est reprise sans relachement.

create or replace function public.can_write_identity(p_base uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select (
    public.is_medecin()
    and exists (select 1 from public.base b where b.id = p_base and b.deleted_at is null)
    and (
      exists (select 1 from public.base b where b.id = p_base and b.owner_user_id = auth.uid())
      or exists (select 1 from public.base_access a
                 where a.base_id = p_base and a.user_id = auth.uid() and a.revoked_at is null
                   and (a.expires_at is null or a.expires_at > now())
                   and a.can_view_identity and a.can_edit_structured_data)
    )
  ) or (
    public.is_saisisseur()
    and exists (select 1 from public.base b where b.id = p_base and b.deleted_at is null)
    and exists (
      select 1 from public.base_access a
      where a.base_id = p_base
        and a.user_id = auth.uid()
        and a.revoked_at is null
        and a.expires_at > now()
        and a.can_view_identity
        and a.can_create_structured_data
    )
  )
$$;

-- Correction atomique de la zone identite complete. Le verrou porte sur la
-- version analytique du patient afin qu'une correction d'identite et une
-- correction de donnees permanentes ne puissent pas valider la meme version.
-- L'audit conserve qui/quand/pourquoi/quels champs, jamais les valeurs nominatives.
create or replace function public.update_patient_identity(
  p_patient_id uuid,
  p_full_name text,
  p_date_of_birth date,
  p_phone text,
  p_address text,
  p_external_identifier text,
  p_reason text,
  p_expected_version bigint
) returns public.patient
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_pat public.patient;
  v_identity public.patient_identity;
  v_full_name text := nullif(btrim(p_full_name), '');
  v_phone text := nullif(btrim(p_phone), '');
  v_address text := nullif(btrim(p_address), '');
  v_external_identifier text := nullif(btrim(p_external_identifier), '');
  v_reason text := nullif(btrim(p_reason), '');
  v_changed_fields text[] := array[]::text[];
  v_from_version bigint;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise';
  end if;
  if v_reason is null then
    raise exception 'Motif de correction requis';
  end if;

  select * into v_pat
  from public.patient
  where id = p_patient_id and deleted_at is null
  for update;
  if not found then raise exception 'Patient introuvable'; end if;

  -- Medecin : proprietaire, ou collaborateur avec identite ET edition.
  -- Saisisseur : mission active avec identite, uniquement son propre brouillon.
  if not (
    (public.is_medecin() and public.can_write_identity(v_pat.base_id))
    or (
      public.is_saisisseur()
      and public.can_write_identity(v_pat.base_id)
      and v_pat.created_by = auth.uid()
      and v_pat.validation_status = 'draft'
    )
  ) then
    raise exception 'Acces refuse';
  end if;

  if p_expected_version is null then
    raise exception 'CONFLIT_VERSION : version patient requise' using errcode = 'P0001';
  end if;
  if v_pat.row_version is distinct from p_expected_version then
    raise exception 'CONFLIT_VERSION : le patient a ete modifie entre-temps' using errcode = 'P0001';
  end if;

  select * into v_identity
  from public.patient_identity
  where base_id = v_pat.base_id
    and patient_code = v_pat.patient_code
    and deleted_at is null
  for update;
  if not found then raise exception 'Identite patient introuvable'; end if;

  if v_identity.full_name is distinct from v_full_name then
    v_changed_fields := array_append(v_changed_fields, 'full_name');
  end if;
  if v_identity.date_of_birth is distinct from p_date_of_birth then
    v_changed_fields := array_append(v_changed_fields, 'date_of_birth');
  end if;
  if v_identity.phone is distinct from v_phone then
    v_changed_fields := array_append(v_changed_fields, 'phone');
  end if;
  if v_identity.address is distinct from v_address then
    v_changed_fields := array_append(v_changed_fields, 'address');
  end if;
  if v_identity.external_identifier is distinct from v_external_identifier then
    v_changed_fields := array_append(v_changed_fields, 'external_identifier');
  end if;

  if cardinality(v_changed_fields) = 0 then
    return v_pat;
  end if;

  update public.patient_identity
  set full_name = v_full_name,
      date_of_birth = p_date_of_birth,
      phone = v_phone,
      address = v_address,
      external_identifier = v_external_identifier
  where id = v_identity.id;

  v_from_version := v_pat.row_version;
  update public.patient
  set updated_at = now()
  where id = v_pat.id
  returning * into v_pat;

  insert into public.audit_log (user_id, action, entity, entity_id, base_id, metadata)
  values (
    auth.uid(),
    'patient_identity_corrected',
    'patient',
    v_pat.id,
    v_pat.base_id,
    jsonb_build_object(
      'reason', v_reason,
      'changed_fields', to_jsonb(v_changed_fields),
      'from_version', v_from_version,
      'to_version', v_pat.row_version
    )
  );

  return v_pat;
end $$;

revoke execute on function public.update_patient_identity(uuid, text, date, text, text, text, text, bigint)
  from public, anon, authenticated;
grant execute on function public.update_patient_identity(uuid, text, date, text, text, text, text, bigint)
  to authenticated;

-- can_write_identity est aussi consommee par les pieces jointes cliniques. Le
-- renversement porte sur les cinq champs nominatifs, pas sur la gestion de fichiers :
-- conserver ici la branche medecin historique evite une extension implicite du lot.
create or replace function public.upload_ticket_authorized(p_base_id uuid, p_bucket text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select case p_bucket
    when 'clinical-attachments' then public.is_medecin() and public.can_write_identity(p_base_id)
    when 'raw-documents' then public.is_base_owner(p_base_id)
    when 'scientific-exports' then false
    else false
  end
$$;
revoke all on function public.upload_ticket_authorized(uuid, text) from public, anon, authenticated;

drop policy if exists ca_insert on public.clinical_attachment;
create policy ca_insert on public.clinical_attachment for insert to authenticated
  with check (
    public.is_medecin()
    and public.can_write_identity(public.base_of_patient(patient_id))
  );

drop policy if exists ca_update on public.clinical_attachment;
create policy ca_update on public.clinical_attachment for update to authenticated
  using (
    public.is_medecin()
    and public.can_write_identity(public.base_of_patient(patient_id))
  )
  with check (
    public.is_medecin()
    and public.can_write_identity(public.base_of_patient(patient_id))
  );

create or replace function public.soft_delete_attachment(p_attachment_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_base uuid;
begin
  select public.base_of_patient(a.patient_id) into v_base
  from public.clinical_attachment a where a.id = p_attachment_id and a.deleted_at is null;
  if v_base is null then raise exception 'Image introuvable'; end if;
  if not (public.is_medecin() and public.can_write_identity(v_base)) then
    raise exception 'Acces refuse';
  end if;
  update public.clinical_attachment
  set deleted_at = now(), deleted_by = auth.uid(), deletion_reason = p_reason
  where id = p_attachment_id;
end $$;
