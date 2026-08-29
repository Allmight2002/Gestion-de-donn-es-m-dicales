-- Vocabulaire (UX V1) : « gabarit » devient « jeu de variables » (personnel) et
-- « modele » (officiel, publie par l'admin). Cette migration ne change AUCUN
-- comportement : elle re-cree a l'identique les fonctions dont un message
-- utilisateur (raise exception) contenait encore « gabarit », avec le nouveau
-- vocabulaire. Corps extraits de l'ETAT FINAL du schema (pg_get_functiondef
-- apres rejeu de toutes les migrations), pas des fichiers individuels.

-- archive_template_version --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.archive_template_version(p_version_id uuid)
 RETURNS template_version
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v public.template_version;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  select * into v from public.template_version where id = p_version_id for update;
  if not found then raise exception 'Version introuvable'; end if;
  if not public.owns_template(v.template_id) then raise exception 'Modification du jeu de variables non autorisee'; end if;
  if v.status <> 'published' then raise exception 'Seule une version published peut etre archivee'; end if;

  delete from public.template_version_status_authorization
   where created_at < now() - interval '1 day';

  insert into public.template_version_status_authorization (txid, version_id, from_status, to_status)
  values (txid_current(), p_version_id, 'published', 'archived')
  on conflict (txid, version_id, from_status, to_status)
  do update set used_at = null, created_at = now();

  update public.template_version
     set status = 'archived'
   where id = p_version_id
   returning * into v;
  return v;
end $function$;

-- assert_no_unknown_fields --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_no_unknown_fields(p_version uuid, p_scope text, p_data jsonb)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare k text;
begin
  if p_data is null then return; end if;
  for k in select jsonb_object_keys(p_data) loop
    if not exists (
      select 1 from public.template_field
      where template_version_id = p_version and scope = p_scope and field_key = k
    ) then
      raise exception 'Champ inconnu du jeu de variables : %', k;
    end if;
  end loop;
end $function$;

-- begin_import_batch --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.begin_import_batch(p_base_id uuid, p_file_hash text, p_template_version_id uuid DEFAULT NULL::uuid, p_conflict text DEFAULT 'fill'::text, p_status text DEFAULT 'draft'::text, p_expected_rows integer DEFAULT NULL::integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_tv uuid; v_id uuid; v_b public.import_batch;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  if not public.can_edit_structured_data(p_base_id) then raise exception 'Acces refuse'; end if;
  if p_status not in ('draft','complete','curated') then raise exception 'Statut invalide'; end if;
  if p_conflict not in ('fill','overwrite','skip') then raise exception 'Mode de conflit invalide'; end if;
  select current_template_version_id into v_tv from public.base where id = p_base_id;
  if v_tv is null then raise exception 'Base introuvable'; end if;
  if p_template_version_id is not null and p_template_version_id <> v_tv then
    raise exception 'Le jeu de variables de la base a change depuis l''apercu ; relancez l''apercu.';
  end if;

  if p_file_hash is not null then
    -- Deja IMPORTE (lot completed) -> refus.
    if exists (select 1 from public.import_batch where base_id = p_base_id and file_hash = p_file_hash and status = 'completed') then
      raise exception 'Ce fichier a deja ete importe sur cette base (doublon evite).';
    end if;
    -- §7.3 : lot EN COURS pour ce fichier -> on le REPREND uniquement si TOUT correspond.
    select * into v_b from public.import_batch
     where base_id = p_base_id and file_hash = p_file_hash and status = 'processing' limit 1;
    if found then
      if v_b.imported_by is distinct from auth.uid()
         or v_b.conflict_mode is distinct from p_conflict
         or v_b.template_version_id is distinct from v_tv
         or v_b.target_validation_status is distinct from p_status then
        raise exception 'Un lot en cours existe pour ce fichier avec d''autres parametres ; annulez-le d''abord.';
      end if;
      return v_b.id;
    end if;
  end if;

  insert into public.import_batch (base_id, file_hash, template_version_id, conflict_mode, target_validation_status, expected_rows, imported_by, status)
  values (p_base_id, p_file_hash, v_tv, p_conflict, p_status, p_expected_rows, auth.uid(), 'processing')
  returning id into v_id;
  perform public.log_audit('data_imported', 'base', p_base_id, p_base_id,
    jsonb_build_object('batch_id', v_id, 'status', p_status, 'conflict', p_conflict, 'expected_rows', p_expected_rows, 'chunked', true));
  return v_id;
end $function$;

-- create_next_personal_template_version --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_next_personal_template_version(p_template_id uuid)
 RETURNS template_version
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_tpl public.template; v_src uuid; v_next int; v_new uuid; result public.template_version;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  select * into v_tpl from public.template where id = p_template_id;
  if not found then raise exception 'Jeu de variables introuvable'; end if;
  -- Modeles GLOBAUX -> reserves a l'admin (duplicate_template_version). Ici : jeu de variables personnel.
  if v_tpl.is_global or v_tpl.owner_user_id is distinct from auth.uid() then
    raise exception 'Reserve au proprietaire de son jeu de variables personnel';
  end if;

  select id, version_number into v_src, v_next from public.template_version
   where template_id = p_template_id order by version_number desc limit 1;
  if v_src is null then raise exception 'Aucune version a dupliquer'; end if;

  insert into public.template_version (template_id, version_number, status, created_by)
  values (p_template_id, v_next + 1, 'draft', auth.uid())
  returning id into v_new;

  -- Champs PUIS regles (les regles referencent des champs qui doivent deja exister).
  insert into public.template_field
    (template_version_id, field_key, label, scope, section, type, unit, allowed_values,
     required, min_value, max_value, allow_missing_codes, display_order, encounter_types)
  select v_new, field_key, label, scope, section, type, unit, allowed_values,
         required, min_value, max_value, allow_missing_codes, display_order, encounter_types
  from public.template_field where template_version_id = v_src;

  insert into public.validation_rule (template_version_id, rule, message, severity)
  select v_new, rule, message, severity
  from public.validation_rule where template_version_id = v_src;

  select * into result from public.template_version where id = v_new;
  return result;
end $function$;

-- create_patient --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_patient(p_base_id uuid, p_patient_code text, p_full_name text, p_date_of_birth date, p_phone text, p_address text, p_external_identifier text, p_permanent_data jsonb)
 RETURNS patient
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_tv uuid; v_patient public.patient;
begin
  if p_patient_code is null or btrim(p_patient_code) = '' then raise exception 'Code patient requis'; end if;
  -- Autorisation EXPLICITE (la fonction est DEFINER : elle ne s'appuie plus sur la RLS).
  if not public.can_edit_structured_data(p_base_id) then raise exception 'Acces refuse'; end if;
  if not public.can_write_identity(p_base_id) then raise exception 'Acces identite requis pour creer un patient'; end if;

  select current_template_version_id into v_tv from public.base where id = p_base_id;
  if v_tv is null then raise exception 'La base n''a pas de version de jeu de variables courante'; end if;

  perform public.assert_data_valid(v_tv, 'patient', coalesce(p_permanent_data, '{}'::jsonb));

  insert into public.patient_identity
    (base_id, patient_code, full_name, date_of_birth, phone, address, external_identifier, created_by)
  values
    (p_base_id, btrim(p_patient_code), p_full_name, p_date_of_birth, p_phone, p_address, p_external_identifier, auth.uid());

  insert into public.patient
    (base_id, patient_code, template_version_id, data, collection_mode, validation_status, created_by)
  values
    (p_base_id, btrim(p_patient_code), v_tv, coalesce(p_permanent_data, '{}'::jsonb), 'direct', 'draft', auth.uid())
  returning * into v_patient;

  return v_patient;
end $function$;

-- delete_template --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_template(p_template_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  if not public.owns_template(p_template_id) then raise exception 'Reserve au proprietaire du jeu de variables'; end if;

  if exists (
    select 1
    from public.template_version tv
    where tv.template_id = p_template_id
      and tv.status in ('published', 'archived')
  ) then
    raise exception 'Jeu de variables publie ou archive : suppression impossible, creez une nouvelle version ou archivez-le';
  end if;

  if exists (
    select 1 from public.template_version tv where tv.template_id = p_template_id and (
         exists (select 1 from public.base b           where b.current_template_version_id = tv.id)
      or exists (select 1 from public.patient p         where p.template_version_id = tv.id)
      or exists (select 1 from public.encounter e       where e.template_version_id = tv.id)
      or exists (select 1 from public.raw_submission rs where rs.template_version_id = tv.id)
    )
  ) then
    raise exception 'Jeu de variables utilise (base ou donnees) : suppression impossible';
  end if;

  delete from public.template where id = p_template_id;
end $function$;

-- delete_template_field --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_template_field(p_field_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare cur public.template_field;
begin
  select * into cur from public.template_field where id = p_field_id;
  if not found then return; end if;
  if not public.owns_template(public.template_of_version(cur.template_version_id)) then
    raise exception 'Modification du jeu de variables non autorisee';
  end if;
  if public.template_field_in_use(p_field_id) then
    raise exception 'Variable deja utilisee : suppression impossible. Creez une nouvelle version du jeu de variables pour la retirer.';
  end if;
  delete from public.template_field where id = p_field_id;
end $function$;

-- duplicate_template_version --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.duplicate_template_version(p_source_version_id uuid)
 RETURNS template_version
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  src      public.template_version;
  v_next   int;
  v_new_id uuid;
  result   public.template_version;
begin
  if not public.is_system_admin() then
    raise exception 'Reserve au gestionnaire de modeles';
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
end $function$;

-- guard_base_template_version --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_base_template_version()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_new_tpl uuid;
  v_old_tpl uuid;
  v_new_owner uuid;
  v_new_global boolean;
begin
  if new.current_template_version_id is not distinct from old.current_template_version_id then
    return new;
  end if;
  if new.current_template_version_id is null then
    raise exception 'Une base doit toujours pointer vers une version de jeu de variables';
  end if;

  select tv.template_id, t.owner_user_id, t.is_global
    into v_new_tpl, v_new_owner, v_new_global
  from public.template_version tv
  join public.template t on t.id = tv.template_id
  where tv.id = new.current_template_version_id;
  if v_new_tpl is null then
    raise exception 'Version de jeu de variables introuvable';
  end if;

  if old.current_template_version_id is null then
    if not (coalesce(v_new_global, false) or v_new_owner = new.owner_user_id) then
      raise exception 'Une base ne peut pointer que vers un jeu de variables lisible et autorise';
    end if;
    return new;
  end if;

  select template_id into v_old_tpl from public.template_version where id = old.current_template_version_id;
  if v_old_tpl is null or v_new_tpl is distinct from v_old_tpl then
    raise exception 'Une base ne peut pointer que vers une version de SON propre jeu de variables (rattachement a un jeu de variables etranger interdit)';
  end if;
  return new;
end $function$;

-- guard_template_field_delete --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_template_field_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if auth.uid() is not null and public.template_version_locked(old.template_version_id) then
    raise exception 'Version publiee/archivee immuable : creez une nouvelle version du jeu de variables';
  end if;
  if public.template_field_in_use(old.id) then
    raise exception 'Variable deja utilisee : suppression impossible. Creez une nouvelle version du jeu de variables pour la retirer.';
  end if;
  return old;
end $function$;

-- guard_template_field_locked_insert --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_template_field_locked_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if auth.uid() is not null and public.template_version_locked(new.template_version_id) then
    raise exception 'Version publiee/archivee immuable : creez une nouvelle version du jeu de variables';
  end if;
  return new;
end $function$;

-- guard_template_field_update --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_template_field_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  semantic boolean;
begin
  if auth.uid() is not null and public.template_version_locked(old.template_version_id) then
    raise exception 'Version publiee/archivee immuable : creez une nouvelle version du jeu de variables';
  end if;

  semantic := (new.field_key is distinct from old.field_key)
           or (new.type      is distinct from old.type)
           or (new.scope     is distinct from old.scope)
           or (new.required  is distinct from old.required)
           or (new.encounter_types is distinct from old.encounter_types)
           or (coalesce(new.allowed_values, 'null'::jsonb) is distinct from coalesce(old.allowed_values, 'null'::jsonb))
           or (new.min_value is distinct from old.min_value)
           or (new.max_value is distinct from old.max_value)
           or (new.allow_missing_codes is distinct from old.allow_missing_codes);
  if semantic and public.template_field_in_use(old.id) then
    raise exception 'Variable deja utilisee : seuls le libelle, la section et l''unite sont modifiables. Pour changer son comportement, creez une nouvelle version du jeu de variables.';
  end if;
  return new;
end $function$;

-- guard_template_version_state --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_template_version_state()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_authorized boolean;
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null and new.status <> 'draft' then
      raise exception 'Une nouvelle version doit etre creee en draft puis publiee par RPC';
    end if;
    return new;
  end if;

  if new.template_id is distinct from old.template_id
     or new.version_number is distinct from old.version_number
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'Colonnes structurelles de template_version immuables';
  end if;

  if new.status is distinct from old.status then
    update public.template_version_status_authorization
       set used_at = now()
     where txid = txid_current()
       and version_id = old.id
       and from_status = old.status
       and to_status = new.status
       and used_at is null
     returning true into v_authorized;

    if not coalesce(v_authorized, false) then
      raise exception 'Transition de version reservee aux RPC publish/archive';
    end if;
  end if;

  if old.status = 'draft' then
    if new.status not in ('draft', 'published') then
      raise exception 'Transition de jeu de variables invalide';
    end if;
    if new.status = 'published' then
      new.published_at := coalesce(new.published_at, now());
    end if;
    return new;
  end if;

  if old.status = 'published' then
    if new.status = 'archived'
       and new.template_id is not distinct from old.template_id
       and new.version_number is not distinct from old.version_number
       and new.created_by is not distinct from old.created_by
       and new.created_at is not distinct from old.created_at
       and new.published_at is not distinct from old.published_at then
      return new;
    end if;
    raise exception 'Version publiee immuable : creez une nouvelle version';
  end if;

  if old.status = 'archived' and new is distinct from old then
    raise exception 'Version archivee immuable';
  end if;

  return new;
end $function$;

-- guard_validation_rule_inuse --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_validation_rule_inuse()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if public.template_version_in_use(coalesce(new.template_version_id, old.template_version_id)) then
    raise exception 'Version de jeu de variables deja utilisee : creez une nouvelle version pour modifier les regles';
  end if;
  return coalesce(new, old);
end $function$;

-- guard_validation_rule_locked --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_validation_rule_locked()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_version uuid := coalesce(new.template_version_id, old.template_version_id);
begin
  if auth.uid() is not null and public.template_version_locked(v_version) then
    raise exception 'Version publiee/archivee immuable : creez une nouvelle version du jeu de variables';
  end if;
  return coalesce(new, old);
end $function$;

-- import_records --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.import_records(p_base_id uuid, p_rows jsonb, p_dry_run boolean DEFAULT true, p_status text DEFAULT 'draft'::text, p_conflict text DEFAULT 'fill'::text, p_file_hash text DEFAULT NULL::text, p_template_version_id uuid DEFAULT NULL::uuid, p_batch_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tv         uuid;
  v_batch      public.import_batch;
  v_bid        uuid;
  r            jsonb;
  idx          int := 0;
  v_code       text;
  v_id         jsonb;
  v_pdata      jsonb;
  v_enc        jsonb;
  v_enc_already boolean;
  v_dob        date;
  v_pid        uuid;
  v_iid        uuid;
  v_existing   uuid;
  v_exdata     jsonb;
  v_exstatus   text;
  v_merged     jsonb;
  v_age        numeric;
  v_rowkey     text;
  k            text;
  has_identity boolean;
  n_pat_new    int := 0;
  n_pat_upd    int := 0;
  n_enc        int := 0;
  n_already    int := 0;
  errors       jsonb := '[]'::jsonb;
  seen_codes   text[] := array[]::text[];
  seen_rows    text[] := array[]::text[];
  ok_rows      text[] := array[]::text[];
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  if not public.can_edit_structured_data(p_base_id) then raise exception 'Acces refuse'; end if;
  if p_status not in ('draft','complete','curated') then raise exception 'Statut invalide'; end if;
  if p_conflict not in ('fill','overwrite','skip') then raise exception 'Mode de conflit invalide'; end if;

  select current_template_version_id into v_tv from public.base where id = p_base_id and deleted_at is null;
  if v_tv is null then raise exception 'Base introuvable'; end if;

  if p_template_version_id is not null and p_template_version_id <> v_tv then
    raise exception 'Le jeu de variables de la base a change depuis l''apercu ; relancez l''apercu.';
  end if;

  if p_batch_id is not null then
    select * into v_batch from public.import_batch where id = p_batch_id for update;
    if not found then raise exception 'Lot d''import introuvable'; end if;
    if v_batch.base_id <> p_base_id then raise exception 'Lot d''import rattache a une autre base'; end if;
    if v_batch.imported_by is distinct from auth.uid() then raise exception 'Lot d''import d''un autre utilisateur'; end if;
    if v_batch.status <> 'processing' then raise exception 'Lot d''import deja cloture (statut=%)', v_batch.status; end if;
    if v_batch.conflict_mode is distinct from p_conflict then raise exception 'Mode de conflit incoherent avec le lot'; end if;
    if v_batch.template_version_id is distinct from v_tv then raise exception 'Version de jeu de variables incoherente avec le lot'; end if;
    if v_batch.target_validation_status is not null and v_batch.target_validation_status <> p_status then
      raise exception 'Statut cible incoherent avec le lot (lot=%, chunk=%)', v_batch.target_validation_status, p_status;
    end if;
  end if;

  if not p_dry_run and p_batch_id is null and p_file_hash is not null
     and exists (select 1 from public.import_batch where base_id = p_base_id and file_hash = p_file_hash and status = 'completed') then
    raise exception 'Ce fichier a deja ete importe sur cette base (doublon evite).';
  end if;

  for r in select value from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    idx := idx + 1;
    begin
      v_rowkey := null;
      v_enc_already := false;
      v_code := nullif(btrim(r ->> 'patient_code'), '');
      if v_code is null then raise exception 'Code patient manquant'; end if;

      v_id := r -> 'identity';
      has_identity := v_id is not null and jsonb_typeof(v_id) = 'object'
                      and (coalesce(v_id ->> 'full_name', '') <> '' or coalesce(v_id ->> 'date_of_birth', '') <> '');
      if has_identity and not public.can_write_identity(p_base_id) then
        raise exception 'Identite presente mais permission manquante (nom / date de naissance)';
      end if;
      if has_identity and coalesce(v_id ->> 'date_of_birth', '') <> ''
         and not public.is_strict_date_text(v_id ->> 'date_of_birth') then
        raise exception 'Date de naissance invalide (format AAAA-MM-JJ attendu)';
      end if;

      v_pdata := coalesce(r -> 'patient_data', '{}'::jsonb);
      v_enc   := r -> 'encounter';
      if v_enc is not null and jsonb_typeof(v_enc) = 'object' then
        if coalesce(v_enc ->> 'encounter_date', '') = '' then
          raise exception 'Date de rencontre manquante';
        end if;
        if not public.is_strict_date_text(v_enc ->> 'encounter_date') then
          raise exception 'Date de rencontre invalide (format AAAA-MM-JJ attendu)';
        end if;
      end if;

      select id, data, validation_status into v_existing, v_exdata, v_exstatus
      from public.patient where base_id = p_base_id and patient_code = v_code and deleted_at is null;

      v_merged := case
        when v_existing is null        then v_pdata
        when p_conflict = 'overwrite'  then coalesce(v_exdata, '{}'::jsonb) || v_pdata
        when p_conflict = 'skip'       then coalesce(v_exdata, '{}'::jsonb)
        else                                v_pdata || coalesce(v_exdata, '{}'::jsonb)
      end;

      perform public.assert_data_valid(v_tv, 'patient', v_pdata);
      if v_enc is not null and jsonb_typeof(v_enc) = 'object' then
        perform public.assert_data_valid(v_tv, 'encounter', coalesce(v_enc -> 'data', '{}'::jsonb));
      end if;
      if p_status = 'curated' then
        if v_existing is null or p_conflict <> 'skip' then
          perform public.assert_required_complete(v_tv, 'patient', v_merged);
        end if;
        if v_enc is not null and jsonb_typeof(v_enc) = 'object' then
          perform public.assert_required_complete(v_tv, 'encounter', coalesce(v_enc -> 'data', '{}'::jsonb), v_enc ->> 'encounter_type');
        end if;
      end if;

      if v_enc is not null and jsonb_typeof(v_enc) = 'object' then
        v_rowkey := v_code || '|' || coalesce(v_enc ->> 'encounter_date', '') || '|'
                    || coalesce(v_enc ->> 'encounter_type', '') || '|' || md5(coalesce(v_enc -> 'data', '{}'::jsonb)::text);
        if exists (
          select 1 from public.import_row_hash h
          where h.base_id = p_base_id and h.row_hash = v_rowkey
            and (p_batch_id is null or h.batch_id <> p_batch_id)
        ) then
          v_enc_already := true;
        elsif p_batch_id is not null then
          if not p_dry_run then
            insert into public.import_row_hash(batch_id, base_id, row_hash) values (p_batch_id, p_base_id, v_rowkey) on conflict do nothing;
            if not found then raise exception 'Rencontre en double dans le fichier (meme patient, date, type et donnees)'; end if;
          end if;
        else
          if v_rowkey = any(seen_rows) then raise exception 'Rencontre en double dans le fichier (meme patient, date, type et donnees)'; end if;
          seen_rows := seen_rows || v_rowkey;
        end if;
      end if;

      if has_identity and coalesce(v_id ->> 'date_of_birth', '') <> '' then
        v_dob := (v_id ->> 'date_of_birth')::date;
      else
        select date_of_birth into v_dob from public.patient_identity
         where base_id = p_base_id and patient_code = v_code and deleted_at is null;
      end if;

      if not p_dry_run then
        if has_identity and (v_existing is null or p_conflict <> 'skip') then
          select id into v_iid from public.patient_identity
           where base_id = p_base_id and patient_code = v_code and deleted_at is null;
          if v_iid is null then
            insert into public.patient_identity (base_id, patient_code, full_name, date_of_birth, created_by)
            values (p_base_id, v_code, nullif(v_id ->> 'full_name', ''), nullif(v_id ->> 'date_of_birth', '')::date, auth.uid());
          else
            update public.patient_identity
               set full_name     = coalesce(nullif(v_id ->> 'full_name', ''), full_name),
                   date_of_birth = coalesce(nullif(v_id ->> 'date_of_birth', '')::date, date_of_birth)
             where id = v_iid;
          end if;
        end if;

        if v_existing is null then
          insert into public.patient (base_id, patient_code, template_version_id, data, collection_mode, validation_status, created_by)
          values (p_base_id, v_code, v_tv, v_pdata, 'direct', p_status, auth.uid())
          returning id into v_pid;
        else
          v_pid := v_existing;
          if p_conflict = 'skip' then
            null;
          elsif p_conflict = 'overwrite' then
            for k in select jsonb_object_keys(v_pdata) loop
              if (v_exdata -> k) is distinct from (v_pdata -> k) then
                insert into public.field_change_log (base_id, entity, entity_id, field_key, old_value, new_value, changed_by, reason, source)
                values (p_base_id, 'patient', v_pid, k, v_exdata -> k, v_pdata -> k, auth.uid(), 'Import (ecrasement)', 'import');
              end if;
            end loop;
            update public.patient
               set data = data || v_pdata,
                   validation_status = case when public.validation_rank(p_status) > public.validation_rank(v_exstatus) then p_status else v_exstatus end,
                   updated_at = now()
             where id = v_pid;
          else
            update public.patient
               set data = v_pdata || data,
                   validation_status = case when public.validation_rank(p_status) > public.validation_rank(v_exstatus) then p_status else v_exstatus end,
                   updated_at = now()
             where id = v_pid;
          end if;
        end if;

        if v_enc is not null and jsonb_typeof(v_enc) = 'object' and not v_enc_already then
          v_age := case
                     when v_dob is not null and coalesce(v_enc ->> 'encounter_date', '') <> ''
                     then public.compute_age(v_dob, (v_enc ->> 'encounter_date')::date, 'years')
                     else null
                   end;
          insert into public.encounter
            (patient_id, template_version_id, encounter_type, encounter_date, age_value, age_unit, data, collection_mode, validation_status, created_by)
          values
            (v_pid, v_tv, coalesce(v_enc ->> 'encounter_type', 'autre'),
             (v_enc ->> 'encounter_date')::date, v_age, case when v_age is not null then 'years' else null end,
             coalesce(v_enc -> 'data', '{}'::jsonb) - 'age_at_encounter', 'direct', p_status, auth.uid());
        end if;
      end if;

      if not (v_code = any(seen_codes)) then
        seen_codes := seen_codes || v_code;
        if v_existing is null then n_pat_new := n_pat_new + 1; else n_pat_upd := n_pat_upd + 1; end if;
      end if;
      if v_enc_already then
        n_already := n_already + 1;
      elsif v_enc is not null and jsonb_typeof(v_enc) = 'object' then
        n_enc := n_enc + 1;
      end if;
      if v_rowkey is not null and not v_enc_already then ok_rows := ok_rows || v_rowkey; end if;

    exception when others then
      errors := errors || jsonb_build_object('row', idx, 'patient_code', coalesce(v_code, ''), 'message', sqlerrm);
    end;
  end loop;

  if not p_dry_run then
    if p_batch_id is not null then
      update public.import_batch
         set row_count = row_count + idx, patients_new = patients_new + n_pat_new,
             patients_updated = patients_updated + n_pat_upd, encounters = encounters + n_enc,
             error_count = error_count + jsonb_array_length(errors), updated_at = now()
       where id = p_batch_id;
    else
      insert into public.import_batch (base_id, file_hash, template_version_id, row_count, patients_new, patients_updated, encounters, conflict_mode, target_validation_status, expected_rows, error_count, imported_by, status, completed_at)
      values (p_base_id, p_file_hash, v_tv, idx, n_pat_new, n_pat_upd, n_enc, p_conflict, p_status, idx, jsonb_array_length(errors), auth.uid(),
              case when jsonb_array_length(errors) > 0 then 'completed_with_errors' else 'completed' end, now())
      returning id into v_bid;
      insert into public.import_row_hash (batch_id, base_id, row_hash)
        select v_bid, p_base_id, unnest(ok_rows)
      on conflict do nothing;
      perform public.log_audit('data_imported', 'base', p_base_id, p_base_id,
        jsonb_build_object('patients_new', n_pat_new, 'patients_updated', n_pat_upd, 'encounters', n_enc,
                           'status', p_status, 'conflict', p_conflict, 'errors', jsonb_array_length(errors),
                           'already_imported', n_already));
    end if;
  end if;

  return jsonb_build_object(
    'dry_run', p_dry_run, 'status', p_status, 'conflict', p_conflict,
    'patients_new', n_pat_new, 'patients_updated', n_pat_upd, 'encounters', n_enc,
    'error_count', jsonb_array_length(errors), 'errors', errors,
    'already_imported', n_already
  );
end $function$;

-- promote_template_to_global --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.promote_template_to_global(p_template_id uuid)
 RETURNS template
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  src       public.template;
  v_src_ver uuid;
  v_tpl     uuid;
  v_ver     uuid;
  result    public.template;
begin
  if not public.is_system_admin() then raise exception 'Reserve a l''administrateur systeme'; end if;
  select * into src from public.template where id = p_template_id;
  if not found then raise exception 'Jeu de variables introuvable'; end if;

  select id into v_src_ver from public.template_version
   where template_id = p_template_id order by version_number desc limit 1;

  insert into public.template (name, specialty, owner_user_id, is_global)
  values (src.name, src.specialty, null, true)
  returning id into v_tpl;

  insert into public.template_version (template_id, version_number, status, created_by)
  values (v_tpl, 1, 'draft', auth.uid())
  returning id into v_ver;

  insert into public.template_field
    (template_version_id, field_key, label, scope, section, type, unit, allowed_values,
     required, min_value, max_value, allow_missing_codes, display_order, encounter_types)
  select v_ver, field_key, label, scope, section, type, unit, allowed_values,
         required, min_value, max_value, allow_missing_codes, display_order, encounter_types
  from public.template_field where template_version_id = v_src_ver;

  insert into public.validation_rule (template_version_id, rule, message, severity)
  select v_ver, rule, message, severity
  from public.validation_rule where template_version_id = v_src_ver;

  delete from public.template_version_status_authorization
   where created_at < now() - interval '1 day';

  insert into public.template_version_status_authorization (txid, version_id, from_status, to_status)
  values (txid_current(), v_ver, 'draft', 'published')
  on conflict (txid, version_id, from_status, to_status)
  do update set used_at = null, created_at = now();

  update public.template_version
     set status = 'published', published_at = now()
   where id = v_ver;

  select * into result from public.template where id = v_tpl;
  return result;
end $function$;

-- publish_template_version --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.publish_template_version(p_version_id uuid)
 RETURNS template_version
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v public.template_version;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  select * into v from public.template_version where id = p_version_id for update;
  if not found then raise exception 'Version introuvable'; end if;
  if not public.owns_template(v.template_id) then raise exception 'Modification du jeu de variables non autorisee'; end if;
  if v.status <> 'draft' then raise exception 'Seule une version draft peut etre publiee'; end if;

  delete from public.template_version_status_authorization
   where created_at < now() - interval '1 day';

  insert into public.template_version_status_authorization (txid, version_id, from_status, to_status)
  values (txid_current(), p_version_id, 'draft', 'published')
  on conflict (txid, version_id, from_status, to_status)
  do update set used_at = null, created_at = now();

  update public.template_version
     set status = 'published', published_at = coalesce(published_at, now())
   where id = p_version_id
   returning * into v;
  return v;
end $function$;

-- reorder_template_fields --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reorder_template_fields(p_version_id uuid, p_field_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare n_given int; n_distinct int; n_real int; n_match int;
begin
  if not public.owns_template(public.template_of_version(p_version_id)) then
    raise exception 'Modification du jeu de variables non autorisee';
  end if;

  -- La liste doit contenir EXACTEMENT les champs de la version, chacun une seule fois
  -- (audit §8.3) : sinon un display_order incoherent (partiel / doublon / champ etranger).
  n_given    := cardinality(p_field_ids);
  n_distinct := (select count(distinct x) from unnest(p_field_ids) x);
  n_real     := (select count(*) from public.template_field where template_version_id = p_version_id);
  n_match    := (select count(*) from public.template_field
                  where template_version_id = p_version_id and id = any(p_field_ids));
  if n_given <> n_distinct or n_given <> n_real or n_match <> n_real then
    raise exception 'Liste de reordonnancement invalide : elle doit contenir exactement les % champs de la version, une fois chacun', n_real;
  end if;

  update public.template_field tf
     set display_order = pos.ord
    from (
      select id, (ordinality - 1)::int as ord
      from unnest(p_field_ids) with ordinality as u(id, ordinality)
    ) pos
   where tf.id = pos.id and tf.template_version_id = p_version_id;
end $function$;

-- set_base_template_version --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_base_template_version(p_base_id uuid, p_version_id uuid)
 RETURNS base
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  b public.base;
  v_old_tpl uuid;
  v_new_tpl uuid;
  v_new_owner uuid;
  v_new_global boolean;
  result public.base;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  if p_version_id is null then raise exception 'Version de jeu de variables requise'; end if;

  select * into b from public.base where id = p_base_id and deleted_at is null for update;
  if not found then raise exception 'Base introuvable'; end if;
  if b.owner_user_id <> auth.uid() then raise exception 'Reserve au proprietaire de la base'; end if;

  select tv.template_id, t.owner_user_id, t.is_global
    into v_new_tpl, v_new_owner, v_new_global
  from public.template_version tv
  join public.template t on t.id = tv.template_id
  where tv.id = p_version_id;
  if v_new_tpl is null then raise exception 'Version de jeu de variables introuvable'; end if;

  if b.current_template_version_id is null then
    if not (coalesce(v_new_global, false) or v_new_owner = b.owner_user_id) then
      raise exception 'Une base ne peut pointer que vers un jeu de variables lisible et autorise';
    end if;
  else
    select template_id into v_old_tpl from public.template_version where id = b.current_template_version_id;
    if v_old_tpl is null or v_new_tpl is distinct from v_old_tpl then
      raise exception 'Une base ne peut pointer que vers une version de SON propre jeu de variables (rattachement a un jeu de variables etranger interdit)';
    end if;
  end if;

  update public.base set current_template_version_id = p_version_id where id = p_base_id returning * into result;
  return result;
end $function$;

-- update_template_field --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_template_field(p_field_id uuid, p_field_key text, p_label text, p_scope text, p_section text, p_type text, p_required boolean, p_encounter_types text[] DEFAULT NULL::text[], p_allowed_values jsonb DEFAULT NULL::jsonb, p_min_value numeric DEFAULT NULL::numeric, p_max_value numeric DEFAULT NULL::numeric, p_unit text DEFAULT NULL::text, p_allow_missing_codes boolean DEFAULT true)
 RETURNS template_field
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare cur public.template_field; semantic boolean; res public.template_field;
begin
  select * into cur from public.template_field where id = p_field_id;
  if not found then raise exception 'Champ introuvable'; end if;
  if not public.owns_template(public.template_of_version(cur.template_version_id)) then
    raise exception 'Modification du jeu de variables non autorisee';
  end if;

  -- Changement SEMANTIQUE (audit §8.2/§8.3) = qui altere le SENS / la validation : nom interne,
  -- type, portee, requis, types de rencontre, valeurs autorisees, bornes, codes manquants.
  -- Interdit si la variable est deja utilisee. Le libelle, la section et l'unite restent libres.
  semantic := (p_field_key       is distinct from cur.field_key)
           or (p_type            is distinct from cur.type)
           or (p_scope           is distinct from cur.scope)
           or (p_required        is distinct from cur.required)
           or ((case when p_scope = 'encounter' then p_encounter_types else null end) is distinct from cur.encounter_types)
           or (coalesce(p_allowed_values, 'null'::jsonb) is distinct from coalesce(cur.allowed_values, 'null'::jsonb))
           or (p_min_value           is distinct from cur.min_value)
           or (p_max_value           is distinct from cur.max_value)
           or (p_allow_missing_codes is distinct from cur.allow_missing_codes);

  if semantic and public.template_field_in_use(p_field_id) then
    raise exception 'Variable deja utilisee : seuls le libelle, la section et l''unite sont modifiables. Pour changer son comportement (nom, type, requis, valeurs, bornes...), creez une nouvelle version du jeu de variables.';
  end if;

  update public.template_field
     set field_key = p_field_key,
         label     = p_label,
         scope     = p_scope,
         section   = p_section,
         type      = p_type,
         required  = p_required,
         encounter_types     = case when p_scope = 'encounter' then p_encounter_types else null end,
         allowed_values      = p_allowed_values,
         min_value           = p_min_value,
         max_value           = p_max_value,
         unit                = p_unit,
         allow_missing_codes = p_allow_missing_codes
   where id = p_field_id
   returning * into res;
  return res;
end $function$;
