-- =============================================================================
-- 20260814090000_template_field_default_value.sql  (L28)
--
-- VALEUR PROPOSEE a la saisie, jamais valeur ecrite d'office.
--
-- `default_value` est une PROPOSITION rendue par le formulaire de creation : une date
-- de consultation proposee a aujourd'hui, un pays propose a Tchad. Le serveur n'ecrit
-- RIEN de lui-meme -- aucune RPC, aucun declencheur ne reinjecte cette valeur. Si la
-- personne qui saisit efface la proposition, le champ reste vide. La colonne ne decrit
-- donc pas la donnee : elle decrit la SAISIE.
--
-- Consequences retenues :
--   * colonne NULLABLE et sans valeur par defaut -> les variables existantes gardent
--     exactement leur sens actuel, sans reecriture de table ;
--   * la proposition est VALIDEE au moment ou la variable est enregistree (type, bornes,
--     liste de valeurs) : une proposition invalide ne doit pas attendre la saisie pour
--     se voir refuser ;
--   * deux jetons dynamiques seulement, `__today__` (date) et `__now__` (datetime) :
--     une date de consultation figee dans le gabarit n'a aucun sens ;
--   * pas de proposition sur `multiselect` ni `terminology` -- proposer un diagnostic
--     ou une liste de modalites oriente la reponse au lieu d'epargner une frappe.
--
-- Le garde-fou clinique ("ne pas proposer de valeur sur complication / issue") est un
-- AVERTISSEMENT du constructeur, pas un refus serveur : la decision reste au medecin,
-- qui connait sa variable. Il n'a donc volontairement pas de contrepartie ici.
--
-- Le lot L28 prevoyait aussi une colonne `is_unique`. Elle est ECARTEE : le registre ne
-- manipule aucun identifiant externe saisi a la main (le code patient, seul identifiant
-- en circulation, est genere par le produit et deja protege par uq_patient_base_code /
-- uq_identity_base_code). Voir docs/lots-paralleles.md.
-- =============================================================================

alter table public.template_field add column default_value text;

-- Garde-fou structurel independant du declencheur : une proposition reste courte.
alter table public.template_field
  add constraint template_field_default_value_length
  check (default_value is null or char_length(default_value) <= 200);

-- =============================================================================
-- 1. Validation de la proposition
-- =============================================================================

-- Le constructeur ECRIT EN DIRECT dans template_field (insert PostgREST) : la validation
-- ne peut donc pas vivre dans la seule RPC de modification. Elle est portee par un
-- declencheur, qui couvre toutes les voies d'ecriture presentes et futures.
create function public.enforce_template_field_default_value()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_default text := nullif(btrim(new.default_value), '');
  v_num     numeric;
begin
  new.default_value := v_default;
  if v_default is null then return new; end if;

  if new.type in ('multiselect', 'terminology') then
    raise exception 'Aucune valeur proposee n''est possible sur "%" : proposer une reponse a une variable de ce type oriente la saisie', new.label;
  end if;

  if new.type = 'boolean' then
    if v_default not in ('true', 'false') then
      raise exception 'Valeur proposee invalide pour "%" : oui ou non attendu', new.label;
    end if;
    return new;
  end if;

  if new.type in ('number', 'integer') then
    if new.type = 'integer' and v_default !~ '^-?[0-9]+$' then
      raise exception 'Valeur proposee invalide pour "%" : un nombre entier est attendu', new.label;
    end if;
    begin
      v_num := v_default::numeric;
    exception when others then
      raise exception 'Valeur proposee invalide pour "%" : un nombre est attendu', new.label;
    end;
    if new.min_value is not null and v_num < new.min_value then
      raise exception 'Valeur proposee hors bornes pour "%" : minimum %', new.label, new.min_value;
    end if;
    if new.max_value is not null and v_num > new.max_value then
      raise exception 'Valeur proposee hors bornes pour "%" : maximum %', new.label, new.max_value;
    end if;
    return new;
  end if;

  -- Une date de consultation proposee a aujourd'hui doit rester « aujourd'hui » le mois
  -- prochain : le jeton est resolu A LA SAISIE, jamais fige ici.
  if new.type = 'date' then
    if v_default = '__today__' then return new; end if;
    begin
      perform v_default::date;
    exception when others then
      raise exception 'Valeur proposee invalide pour "%" : une date est attendue', new.label;
    end;
    return new;
  end if;

  if new.type = 'datetime' then
    if v_default = '__now__' then return new; end if;
    begin
      perform v_default::timestamp;
    exception when others then
      raise exception 'Valeur proposee invalide pour "%" : une date et une heure sont attendues', new.label;
    end;
    return new;
  end if;

  if new.type = 'select' then
    if new.allowed_values is null
       or not (new.allowed_values @> jsonb_build_array(v_default)) then
      raise exception 'Valeur proposee absente de la liste de "%"', new.label;
    end if;
    return new;
  end if;

  return new;
end $$;
revoke all on function public.enforce_template_field_default_value() from public, anon, authenticated;

create trigger trg_template_field_default_value
  before insert or update of default_value, type, allowed_values, min_value, max_value
  on public.template_field
  for each row execute function public.enforce_template_field_default_value();

-- =============================================================================
-- 2. Recopie des variables d'une version a l'autre
-- =============================================================================

-- La liste des colonnes recopiees etait DUPLIQUEE dans six fonctions. La consigne de
-- saisie ajoutee par L27 n'y avait pas ete reportee : dupliquer un gabarit perdait
-- silencieusement toutes les consignes, et `promote_template_to_global` perdait en plus
-- les types de rencontre. Une proposition perdue au meme endroit produirait le meme
-- defaut discret. La liste vit desormais a UN SEUL endroit.
create function public.copy_template_fields(
  p_source_version_id  uuid,
  p_target_version_id  uuid,
  p_force_patient_scope boolean default false
) returns void
language sql security invoker set search_path = public, pg_temp as $$
  insert into public.template_field
    (template_version_id, field_key, label, description, default_value, scope, section, type,
     unit, allowed_values, required, min_value, max_value, allow_missing_codes, display_order,
     encounter_types)
  select p_target_version_id, field_key, label, description, default_value,
         case when p_force_patient_scope then 'patient' else scope end,
         section, type, unit, allowed_values, required, min_value, max_value,
         allow_missing_codes, display_order,
         case when p_force_patient_scope then null else encounter_types end
  from public.template_field
  where template_version_id = p_source_version_id
  order by display_order, id;
$$;
revoke all on function public.copy_template_fields(uuid, uuid, boolean) from public, anon, authenticated;

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
  perform public.copy_template_fields(p_source_version_id, v_new_id);

  -- Recopie des regles de validation.
  insert into public.validation_rule (template_version_id, rule, message, severity)
  select v_new_id, rule, message, severity
  from public.validation_rule
  where template_version_id = p_source_version_id;

  select * into result from public.template_version where id = v_new_id;
  return result;
end $$;

create or replace function public.create_next_personal_template_version(p_template_id uuid)
returns public.template_version
language plpgsql security definer set search_path = public, pg_temp as $$
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
  perform public.copy_template_fields(v_src, v_new);

  insert into public.validation_rule (template_version_id, rule, message, severity)
  select v_new, rule, message, severity
  from public.validation_rule where template_version_id = v_src;

  select * into result from public.template_version where id = v_new;
  return result;
end $$;

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

  perform public.copy_template_fields(p_source_version_id, v_ver);

  insert into public.validation_rule (template_version_id, rule, message, severity)
  select v_ver, rule, message, severity
  from public.validation_rule where template_version_id = p_source_version_id;

  insert into public.base (name, specialty, owner_user_id, current_template_version_id)
  values (p_name, nullif(p_specialty, ''), auth.uid(), v_ver)
  returning * into v_base;

  return v_base;
end $$;

create or replace function public.create_base_from_model_observation(
  p_name text, p_specialty text, p_source_version_id uuid, p_observation_model text
) returns public.base
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  src_v public.template_version;
  src_t public.template;
  v_tpl uuid;
  v_ver uuid;
  v_base public.base;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  if not public.is_medecin() then raise exception 'Seul un medecin peut creer une base'; end if;
  if p_observation_model not in ('cross_sectional', 'longitudinal', 'event_registry') then
    raise exception 'Modele d''observation invalide';
  end if;
  select * into src_v from public.template_version where id = p_source_version_id;
  if not found then raise exception 'Modele source introuvable'; end if;
  select * into src_t from public.template where id = src_v.template_id;
  if not (src_t.is_global or src_t.owner_user_id = auth.uid()) then raise exception 'Modele non accessible'; end if;
  insert into public.template (name, specialty, owner_user_id, is_global)
  values (src_t.name, src_t.specialty, auth.uid(), false) returning id into v_tpl;
  insert into public.template_version (template_id, version_number, status, created_by)
  values (v_tpl, 1, 'draft', auth.uid()) returning id into v_ver;
  perform public.copy_template_fields(p_source_version_id, v_ver, p_observation_model = 'cross_sectional');
  insert into public.validation_rule (template_version_id, rule, message, severity)
  select v_ver, rule, message, severity from public.validation_rule where template_version_id = p_source_version_id;
  insert into public.base (name, specialty, owner_user_id, current_template_version_id, observation_model)
  values (p_name, nullif(p_specialty, ''), auth.uid(), v_ver, p_observation_model) returning * into v_base;
  return v_base;
end $$;

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
  if not found then raise exception 'Jeu de variables introuvable'; end if;

  select id into v_src_ver from public.template_version
   where template_id = p_template_id order by version_number desc limit 1;

  insert into public.template (name, specialty, owner_user_id, is_global)
  values (src.name, src.specialty, null, true)
  returning id into v_tpl;

  insert into public.template_version (template_id, version_number, status, created_by)
  values (v_tpl, 1, 'draft', auth.uid())
  returning id into v_ver;

  perform public.copy_template_fields(v_src_ver, v_ver);

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
end $$;

-- create_template_bundle : SEULE la branche de COPIE change. La branche « champs fournis »
-- continue de refuser un `defaultValue` (garde-fou d'origine) : un gabarit construit depuis
-- un fichier ou depuis la bibliotheque ne porte pas de proposition, elle s'ajoute ensuite
-- variable par variable dans le constructeur.
create or replace function public.create_template_bundle(p_payload jsonb, p_operation_key uuid)
returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_hash text;
  v_existing public.template_operation;
  v_name text;
  v_specialty text;
  v_is_global boolean;
  v_source_version_id uuid;
  v_source_template public.template;
  v_source_version public.template_version;
  v_with_base boolean;
  v_base_name text;
  v_template_id uuid;
  v_version_id uuid;
  v_base public.base;
  v_fields jsonb;
  v_count int;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception using errcode = 'P0001', message = '{"code":"UNAUTHENTICATED"}';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' or p_operation_key is null then
    raise exception using errcode = 'P0001', message = '{"code":"INVALID_REQUEST"}';
  end if;

  v_name := btrim(coalesce(p_payload ->> 'name', ''));
  v_specialty := nullif(btrim(coalesce(p_payload ->> 'specialty', '')), '');
  v_is_global := coalesce((p_payload ->> 'isGlobal')::boolean, false);
  v_with_base := coalesce((p_payload ->> 'withBase')::boolean, false);
  v_base_name := btrim(coalesce(p_payload ->> 'baseName', ''));
  v_fields := coalesce(p_payload -> 'fields', '[]'::jsonb);
  v_source_version_id := nullif(p_payload ->> 'sourceVersionId', '')::uuid;

  -- Validation complete avant toute ecriture persistante.
  if v_name = '' or char_length(v_name) > 120 then
    raise exception using errcode = 'P0001', message = '{"code":"INVALID_TEMPLATE_NAME","field":"name"}';
  end if;
  if v_specialty is not null and char_length(v_specialty) > 120 then
    raise exception using errcode = 'P0001', message = '{"code":"INVALID_SPECIALTY","field":"specialty"}';
  end if;
  if jsonb_typeof(v_fields) <> 'array' then
    raise exception using errcode = 'P0001', message = '{"code":"INVALID_FIELDS","field":"fields"}';
  end if;
  v_count := jsonb_array_length(v_fields);
  if v_count > 500 then
    raise exception using errcode = 'P0001', message = '{"code":"FIELD_LIMIT_EXCEEDED","field":"fields"}';
  end if;
  if v_with_base and (v_base_name = '' or char_length(v_base_name) > 120) then
    raise exception using errcode = 'P0001', message = '{"code":"INVALID_BASE_NAME","field":"baseName"}';
  end if;
  if v_is_global and not public.is_system_admin() then
    raise exception using errcode = 'P0001', message = '{"code":"FORBIDDEN"}';
  end if;
  if not v_is_global and not public.is_medecin() then
    raise exception using errcode = 'P0001', message = '{"code":"FORBIDDEN"}';
  end if;
  if v_with_base and (v_is_global or not public.is_medecin()) then
    raise exception using errcode = 'P0001', message = '{"code":"BASE_NOT_ALLOWED"}';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_fields) f
    where jsonb_typeof(f) <> 'object'
       or btrim(coalesce(f ->> 'fieldKey', '')) !~ '^[a-z][a-z0-9_]{0,62}$'
       or btrim(coalesce(f ->> 'label', '')) = '' or char_length(btrim(coalesce(f ->> 'label', ''))) > 160
       or coalesce(f ->> 'scope', '') not in ('patient', 'encounter')
       or coalesce(f ->> 'section', '') not in ('clinique', 'biologie', 'paraclinique')
       or coalesce(f ->> 'type', '') not in ('number','integer','text','date','datetime','boolean','select','multiselect')
       or (f ? 'defaultValue' and f -> 'defaultValue' <> 'null'::jsonb)
  ) then
    raise exception using errcode = 'P0001', message = '{"code":"INVALID_FIELD","field":"fields"}';
  end if;
  if exists (select 1 from jsonb_array_elements(v_fields) f group by lower(btrim(f ->> 'fieldKey')) having count(*) > 1) then
    raise exception using errcode = 'P0001', message = '{"code":"DUPLICATE_FIELD_KEY","field":"fields"}';
  end if;
  if exists (select 1 from jsonb_array_elements(v_fields) f group by lower(btrim(f ->> 'label')) having count(*) > 1) then
    raise exception using errcode = 'P0001', message = '{"code":"DUPLICATE_FIELD_LABEL","field":"fields"}';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_fields) f
    where ((f ->> 'type') in ('select', 'multiselect') and (not (f ? 'allowedValues') or jsonb_typeof(f -> 'allowedValues') <> 'array'))
       or ((f ->> 'type') not in ('select', 'multiselect') and f ? 'allowedValues' and f -> 'allowedValues' <> 'null'::jsonb)
       or (f ? 'minValue' and f -> 'minValue' <> 'null'::jsonb and jsonb_typeof(f -> 'minValue') <> 'number')
       or (f ? 'maxValue' and f -> 'maxValue' <> 'null'::jsonb and jsonb_typeof(f -> 'maxValue') <> 'number')
       or (f ? 'minValue' and f ? 'maxValue' and (f ->> 'minValue')::numeric > (f ->> 'maxValue')::numeric)
       or ((f ->> 'scope') = 'patient' and f ? 'encounterTypes' and f -> 'encounterTypes' <> 'null'::jsonb)
       or ((f ->> 'scope') = 'encounter' and f ? 'encounterTypes' and f -> 'encounterTypes' <> 'null'::jsonb
           and (jsonb_typeof(f -> 'encounterTypes') <> 'array' or exists (
             select 1 from jsonb_array_elements_text(f -> 'encounterTypes') et
             where et not in ('consultation', 'hospitalisation', 'suivi', 'autre')
           )))
  ) then
    raise exception using errcode = 'P0001', message = '{"code":"INVALID_FIELD_CONSTRAINT","field":"fields"}';
  end if;

  -- Hash apres validation : une meme cle ne peut jamais etre reutilisee avec un autre payload.
  v_hash := encode(digest(p_payload::text, 'sha256'), 'hex');
  insert into public.template_operation(owner_user_id, operation_key, payload_hash, result)
  values (v_uid, p_operation_key, v_hash, '{}'::jsonb)
  on conflict do nothing;
  select * into v_existing from public.template_operation
   where owner_user_id = v_uid and operation_key = p_operation_key for update;
  if v_existing.result <> '{}'::jsonb then
    if v_existing.payload_hash <> v_hash then
      raise exception using errcode = 'P0001', message = '{"code":"IDEMPOTENCY_KEY_REUSED"}';
    end if;
    return v_existing.result;
  end if;

  if v_source_version_id is not null then
    select * into v_source_version from public.template_version where id = v_source_version_id for share;
    if not found then raise exception using errcode = 'P0001', message = '{"code":"SOURCE_NOT_FOUND"}'; end if;
    select * into v_source_template from public.template where id = v_source_version.template_id for share;
    if not (v_source_template.is_global or v_source_template.owner_user_id = v_uid or public.is_system_admin()) then
      raise exception using errcode = 'P0001', message = '{"code":"SOURCE_FORBIDDEN"}';
    end if;
    if v_count <> 0 then raise exception using errcode = 'P0001', message = '{"code":"SOURCE_AND_FIELDS_CONFLICT"}'; end if;
  end if;

  insert into public.template(name, specialty, owner_user_id, is_global)
  values (v_name, v_specialty, case when v_is_global then null else v_uid end, v_is_global)
  returning id into v_template_id;
  insert into public.template_version(template_id, version_number, status, created_by)
  values (v_template_id, 1, 'draft', v_uid) returning id into v_version_id;

  if v_source_version_id is not null then
    -- FOR SHARE ci-dessus garantit un snapshot coherent des attributs copies.
    perform public.copy_template_fields(v_source_version_id, v_version_id);
    insert into public.validation_rule(template_version_id, rule, message, severity)
    select v_version_id, rule, message, severity from public.validation_rule where template_version_id = v_source_version_id order by id;
  else
    insert into public.template_field(template_version_id, field_key, label, scope, section, type, unit, allowed_values, required, min_value, max_value, allow_missing_codes, display_order, encounter_types)
    select v_version_id, btrim(f.value ->> 'fieldKey'), btrim(f.value ->> 'label'), f.value ->> 'scope', f.value ->> 'section', f.value ->> 'type',
      nullif(btrim(coalesce(f.value ->> 'unit', '')), ''), f.value -> 'allowedValues', coalesce((f.value ->> 'required')::boolean, false),
      nullif(f.value ->> 'minValue', '')::numeric, nullif(f.value ->> 'maxValue', '')::numeric, coalesce((f.value ->> 'allowMissingCodes')::boolean, false), f.ordinality - 1,
      case when f.value ->> 'scope' = 'encounter' then array(select jsonb_array_elements_text(coalesce(f.value -> 'encounterTypes', '[]'::jsonb))) else null end
    from jsonb_array_elements(v_fields) with ordinality as f(value, ordinality)
    order by f.ordinality;
  end if;
  if v_with_base then
    insert into public.base(name, specialty, owner_user_id, current_template_version_id)
    values (v_base_name, v_specialty, v_uid, v_version_id) returning * into v_base;
  end if;
  v_result := jsonb_build_object('templateId', v_template_id, 'versionId', v_version_id, 'baseId', case when v_with_base then v_base.id else null end);
  update public.template_operation set result = v_result where owner_user_id = v_uid and operation_key = p_operation_key;
  return v_result;
end $$;

-- =============================================================================
-- 3. Modification d'une variable
-- =============================================================================

-- La proposition n'est PAS structurelle : elle ne change le sens d'aucune donnee deja
-- saisie et reste donc corrigeable sur une variable en service, comme le libelle ou la
-- consigne. L'ancienne signature reste disponible pour un client en transition.
create function public.update_template_field(
  p_field_id uuid, p_field_key text, p_label text, p_description text, p_default_value text,
  p_scope text, p_section text, p_type text, p_required boolean,
  p_encounter_types text[] default null, p_allowed_values jsonb default null,
  p_min_value numeric default null, p_max_value numeric default null,
  p_unit text default null, p_allow_missing_codes boolean default true
) returns public.template_field
language plpgsql security definer set search_path = public, pg_temp as $$
declare cur public.template_field; semantic boolean; res public.template_field;
begin
  select * into cur from public.template_field where id = p_field_id;
  if not found then raise exception 'Champ introuvable'; end if;
  if not public.owns_template(public.template_of_version(cur.template_version_id)) then
    raise exception 'Modification du gabarit non autorisee';
  end if;
  semantic := (p_field_key is distinct from cur.field_key)
           or (p_type is distinct from cur.type) or (p_scope is distinct from cur.scope)
           or (p_required is distinct from cur.required)
           or ((case when p_scope = 'encounter' then p_encounter_types else null end) is distinct from cur.encounter_types)
           or (coalesce(p_allowed_values, 'null'::jsonb) is distinct from coalesce(cur.allowed_values, 'null'::jsonb))
           or (p_min_value is distinct from cur.min_value) or (p_max_value is distinct from cur.max_value)
           or (p_allow_missing_codes is distinct from cur.allow_missing_codes);
  if semantic and public.template_field_in_use(p_field_id) then
    raise exception 'Variable deja utilisee : seuls le libelle, la consigne de saisie, la valeur proposee, la section et l''unite sont modifiables. Pour changer son comportement, creez une nouvelle version du gabarit.';
  end if;
  update public.template_field
     set field_key = p_field_key, label = p_label, description = nullif(btrim(p_description), ''),
         default_value = nullif(btrim(p_default_value), ''),
         scope = p_scope, section = p_section, type = p_type, required = p_required,
         encounter_types = case when p_scope = 'encounter' then p_encounter_types else null end,
         allowed_values = p_allowed_values, min_value = p_min_value, max_value = p_max_value,
         unit = p_unit, allow_missing_codes = p_allow_missing_codes
   where id = p_field_id returning * into res;
  return res;
end $$;
revoke all on function public.update_template_field(uuid, text, text, text, text, text, text, text, boolean, text[], jsonb, numeric, numeric, text, boolean) from public, anon;
grant execute on function public.update_template_field(uuid, text, text, text, text, text, text, text, boolean, text[], jsonb, numeric, numeric, text, boolean) to authenticated;

-- =============================================================================
-- 4. Instantane hors-ligne
-- =============================================================================

-- Le formulaire hors-ligne est le MEME composant que le formulaire en ligne : sans la
-- proposition dans l'instantane, la meme variable se prerempliraient en ligne et resterait
-- vide hors-ligne. La consigne de saisie (L27) manquait pour la meme raison ; elle est
-- ajoutee ici, au meme endroit.
create or replace function public.download_base_snapshot(p_base_id uuid)
returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'base', (
      select jsonb_build_object('id', b.id, 'name', b.name, 'templateVersionId', b.current_template_version_id)
      from public.base b where b.id = p_base_id
    ),
    'fields', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', tf.id, 'fieldKey', tf.field_key, 'label', tf.label,
        'description', tf.description, 'defaultValue', tf.default_value,
        'scope', tf.scope, 'type', tf.type, 'displayOrder', tf.display_order,
        'section', tf.section, 'unit', tf.unit, 'allowedValues', tf.allowed_values,
        'required', tf.required, 'minValue', tf.min_value, 'maxValue', tf.max_value,
        'allowMissingCodes', tf.allow_missing_codes, 'encounterTypes', to_jsonb(tf.encounter_types)
      ) order by tf.display_order, tf.field_key)
      from public.template_field tf
      where tf.template_version_id = (select current_template_version_id from public.base where id = p_base_id)
    ), '[]'::jsonb),
    'fieldsByVersion', coalesce((
      select jsonb_object_agg(v.tvid::text, v.fields)
      from (
        select tf.template_version_id as tvid,
               jsonb_agg(jsonb_build_object(
                 'id', tf.id, 'fieldKey', tf.field_key, 'label', tf.label,
                 'description', tf.description, 'defaultValue', tf.default_value,
                 'scope', tf.scope, 'type', tf.type, 'displayOrder', tf.display_order,
                 'section', tf.section, 'unit', tf.unit, 'allowedValues', tf.allowed_values,
                 'required', tf.required, 'minValue', tf.min_value, 'maxValue', tf.max_value,
                 'allowMissingCodes', tf.allow_missing_codes, 'encounterTypes', to_jsonb(tf.encounter_types)
               ) order by tf.display_order, tf.field_key) as fields
        from public.template_field tf
        where tf.template_version_id in (
          select p.template_version_id from public.patient p
            where p.base_id = p_base_id and p.deleted_at is null
          union
          select e.template_version_id from public.encounter e
            join public.patient p on p.id = e.patient_id
            where p.base_id = p_base_id and p.deleted_at is null and e.deleted_at is null
        )
        group by tf.template_version_id
      ) v
    ), '{}'::jsonb),
    'rulesByVersion', coalesce((
      select jsonb_object_agg(v.tvid::text, v.rules)
      from (
        select vr.template_version_id as tvid,
               jsonb_agg(jsonb_build_object(
                 'id', vr.id,
                 'rule', vr.rule,
                 'message', vr.message,
                 'severity', vr.severity
               ) order by vr.id) as rules
        from public.validation_rule vr
        where vr.template_version_id in (
          select b.current_template_version_id from public.base b
            where b.id = p_base_id and b.current_template_version_id is not null
          union
          select p.template_version_id from public.patient p
            where p.base_id = p_base_id and p.deleted_at is null
          union
          select e.template_version_id from public.encounter e
            join public.patient p on p.id = e.patient_id
            where p.base_id = p_base_id and p.deleted_at is null and e.deleted_at is null
        )
        group by vr.template_version_id
      ) v
    ), '{}'::jsonb),
    'patients', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'code', p.patient_code, 'templateVersionId', p.template_version_id,
        'data', p.data, 'validationStatus', p.validation_status,
        'encounters', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', e.id, 'encounterType', e.encounter_type, 'encounterDate', e.encounter_date,
            'validationStatus', e.validation_status, 'ageValue', e.age_value, 'ageUnit', e.age_unit,
            'data', e.data, 'updatedAt', e.updated_at, 'templateVersionId', e.template_version_id
          ) order by e.encounter_date)
          from public.encounter e where e.patient_id = p.id and e.deleted_at is null
        ), '[]'::jsonb)
      ) order by p.created_at)
      from public.patient p where p.base_id = p_base_id and p.deleted_at is null
    ), '[]'::jsonb)
  );
$$;
revoke all on function public.download_base_snapshot(uuid) from public, anon, authenticated;
grant execute on function public.download_base_snapshot(uuid) to authenticated;
