-- =============================================================================
-- 20260616090700_template_admin.sql
-- Outil d'administration des gabarits (cahier §8.2) : duplication d'une version.
--
-- La publication = simple UPDATE status='published' (autorise au staff par la RLS,
-- transition draft->published autorisee par le trigger d'immuabilite).
-- La duplication merite une fonction atomique : creer une nouvelle version DRAFT
-- en recopiant champs + regles d'une version existante (immuable).
-- =============================================================================

create or replace function public.duplicate_template_version(p_source_version_id uuid)
returns public.template_version
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  src      public.template_version;
  v_next   int;
  v_new_id uuid;
  result   public.template_version;
begin
  if not public.is_system_admin() then
    raise exception 'Reserve au gestionnaire de gabarits';
  end if;

  select * into src from public.template_version where id = p_source_version_id;
  if not found then
    raise exception 'Version source introuvable';
  end if;

  select coalesce(max(version_number), 0) + 1 into v_next
  from public.template_version where template_id = src.template_id;

  insert into public.template_version (template_id, version_number, status, created_by)
  values (src.template_id, v_next, 'draft', auth.uid())
  returning id into v_new_id;

  -- Recopie des champs (la nouvelle version est draft -> inserts autorises).
  insert into public.template_field
    (template_version_id, field_key, label, scope, section, type, unit, allowed_values,
     required, min_value, max_value, allow_missing_codes, display_order, encounter_types)
  select v_new_id, field_key, label, scope, section, type, unit, allowed_values,
         required, min_value, max_value, allow_missing_codes, display_order, encounter_types
  from public.template_field
  where template_version_id = p_source_version_id;

  -- Recopie des regles de validation.
  insert into public.validation_rule (template_version_id, rule, message, severity)
  select v_new_id, rule, message, severity
  from public.validation_rule
  where template_version_id = p_source_version_id;

  select * into result from public.template_version where id = v_new_id;
  return result;
end $$;

grant execute on function public.duplicate_template_version(uuid) to authenticated;

-- =============================================================================
-- v3.0 : a la creation d'une base, le medecin COPIE un modele (global ou un de ses
-- gabarits) en un gabarit PERSONNEL editable, et la base pointe dessus. Atomique.
-- =============================================================================
create or replace function public.create_base_from_model(p_name text, p_specialty text, p_source_version_id uuid)
returns public.base
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  src_v   public.template_version;
  src_t   public.template;
  v_tpl   uuid;
  v_ver   uuid;
  v_base  public.base;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  if not public.is_medecin() then raise exception 'Seul un medecin peut creer une base'; end if;

  select * into src_v from public.template_version where id = p_source_version_id;
  if not found then raise exception 'Modele source introuvable'; end if;
  select * into src_t from public.template where id = src_v.template_id;
  if not (src_t.is_global or src_t.owner_user_id = auth.uid()) then
    raise exception 'Modele non accessible';
  end if;

  -- Gabarit personnel (copie) : statut 'draft' => editable librement par le medecin.
  insert into public.template (name, specialty, owner_user_id, is_global)
  values (src_t.name, src_t.specialty, auth.uid(), false)
  returning id into v_tpl;

  insert into public.template_version (template_id, version_number, status, created_by)
  values (v_tpl, 1, 'draft', auth.uid())
  returning id into v_ver;

  insert into public.template_field
    (template_version_id, field_key, label, scope, section, type, unit, allowed_values,
     required, min_value, max_value, allow_missing_codes, display_order, encounter_types)
  select v_ver, field_key, label, scope, section, type, unit, allowed_values,
         required, min_value, max_value, allow_missing_codes, display_order, encounter_types
  from public.template_field where template_version_id = p_source_version_id;

  insert into public.validation_rule (template_version_id, rule, message, severity)
  select v_ver, rule, message, severity
  from public.validation_rule where template_version_id = p_source_version_id;

  insert into public.base (name, specialty, owner_user_id, current_template_version_id)
  values (p_name, nullif(p_specialty, ''), auth.uid(), v_ver)
  returning * into v_base;

  return v_base;
end $$;
grant execute on function public.create_base_from_model(text, text, uuid) to authenticated;

-- L'admin PROMEUT un gabarit (copie) en modele GLOBAL propose a tous les medecins.
create or replace function public.promote_template_to_global(p_template_id uuid)
returns public.template
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  src       public.template;
  v_src_ver uuid;
  v_tpl     uuid;
  v_ver     uuid;
  result    public.template;
begin
  if not public.is_system_admin() then raise exception 'Reserve a l''administrateur systeme'; end if;
  select * into src from public.template where id = p_template_id;
  if not found then raise exception 'Gabarit introuvable'; end if;

  select id into v_src_ver from public.template_version
   where template_id = p_template_id order by version_number desc limit 1;

  insert into public.template (name, specialty, owner_user_id, is_global)
  values (src.name, src.specialty, null, true)
  returning id into v_tpl;

  insert into public.template_version (template_id, version_number, status, created_by, published_at)
  values (v_tpl, 1, 'published', auth.uid(), now())
  returning id into v_ver;

  insert into public.template_field
    (template_version_id, field_key, label, scope, section, type, unit, allowed_values,
     required, min_value, max_value, allow_missing_codes, display_order)
  select v_ver, field_key, label, scope, section, type, unit, allowed_values,
         required, min_value, max_value, allow_missing_codes, display_order
  from public.template_field where template_version_id = v_src_ver;

  insert into public.validation_rule (template_version_id, rule, message, severity)
  select v_ver, rule, message, severity
  from public.validation_rule where template_version_id = v_src_ver;

  select * into result from public.template where id = v_tpl;
  return result;
end $$;
grant execute on function public.promote_template_to_global(uuid) to authenticated;

-- =============================================================================
-- Suppression d'un gabarit (proprietaire OU admin via owns_template). RPC pour porter une
-- GARDE claire : refus si une version du gabarit est utilisee (base courante, patient,
-- rencontre ou soumission) — sinon la suppression echouerait sur une FK cryptique. La
-- suppression cascade sur versions / champs / regles. (Renommer = simple UPDATE via RLS.)
-- =============================================================================
create or replace function public.delete_template(p_template_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  if not public.owns_template(p_template_id) then raise exception 'Reserve au proprietaire du gabarit'; end if;

  if exists (
    select 1 from public.template_version tv where tv.template_id = p_template_id and (
         exists (select 1 from public.base b           where b.current_template_version_id = tv.id)
      or exists (select 1 from public.patient p         where p.template_version_id = tv.id)
      or exists (select 1 from public.encounter e       where e.template_version_id = tv.id)
      or exists (select 1 from public.raw_submission rs where rs.template_version_id = tv.id)
    )
  ) then
    raise exception 'Gabarit utilise (base ou donnees) : suppression impossible';
  end if;

  delete from public.template where id = p_template_id; -- cascade versions/champs/regles
end $$;
grant execute on function public.delete_template(uuid) to authenticated;
