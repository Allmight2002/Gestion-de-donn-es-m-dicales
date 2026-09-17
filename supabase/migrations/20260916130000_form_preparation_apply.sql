-- =============================================================================
-- E2 : application atomique d'une preparation de formulaire
--
-- Cette migration ajoute uniquement la voie structurelle de l'application. Une
-- preparation est relue sous verrou, reclassee par le serveur, puis recopiee
-- vers une version technique draft. Les lignes patient/rencontre et leurs
-- valeurs ne sont jamais touchees par ce chemin.
--
-- Les copies portent des identifiants propres et une provenance immediate. Les
-- lignes validation_rule restent les objets metier existants : cette migration
-- n'introduit pas de table de regles parallele.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Provenance de la revision technique et des objets recopies
-- -----------------------------------------------------------------------------

alter table public.template_version
  add column if not exists derived_from_template_version_id uuid,
  add column if not exists derived_from_preparation_id uuid,
  add column if not exists derived_from_content_fingerprint text,
  add column if not exists applied_operation_id uuid,
  add column if not exists applied_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.template_version'::regclass
       and conname = 'template_version_derived_from_version_fk'
  ) then
    alter table public.template_version
      add constraint template_version_derived_from_version_fk
      foreign key (derived_from_template_version_id)
      references public.template_version(id) on delete set null;
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.template_version'::regclass
       and conname = 'template_version_derived_from_preparation_fk'
  ) then
    alter table public.template_version
      add constraint template_version_derived_from_preparation_fk
      foreign key (derived_from_preparation_id)
      references public.form_preparation(id) on delete set null;
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.template_version'::regclass
       and conname = 'template_version_derived_from_fingerprint_check'
  ) then
    alter table public.template_version
      add constraint template_version_derived_from_fingerprint_check
      check (derived_from_content_fingerprint is null
             or derived_from_content_fingerprint ~ '^sha256:[0-9a-f]{64}$');
  end if;
end
$$;

comment on column public.template_version.derived_from_template_version_id is
  'Version source immediate de la revision technique E2 ; aucune reference n est utilisee pour le rendu.';
comment on column public.template_version.derived_from_preparation_id is
  'Preparation E1 qui a produit cette revision technique, sans valeur clinique.';
comment on column public.template_version.derived_from_content_fingerprint is
  'Empreinte du payload structurel normalise ayant produit la revision.';
comment on column public.template_version.applied_operation_id is
  'Cle idempotente de l application E2 ; elle ne constitue pas une autorisation.';

alter table public.template_field
  add column if not exists source_template_version_id uuid,
  add column if not exists source_field_key text;

alter table public.template_common_group
  add column if not exists source_template_version_id uuid,
  add column if not exists source_group_key text;

alter table public.validation_rule
  add column if not exists source_template_version_id uuid,
  add column if not exists source_validation_rule_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.template_section'::regclass
       and conname = 'template_section_source_key_fk'
  ) then
    alter table public.template_section
      add constraint template_section_source_key_fk
      foreign key (source_template_version_id, source_section_key)
      references public.template_section(template_version_id, section_key)
      on delete set null;
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.template_field'::regclass
       and conname = 'template_field_source_version_fk'
  ) then
    alter table public.template_field
      add constraint template_field_source_version_fk
      foreign key (source_template_version_id)
      references public.template_version(id) on delete set null;
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.template_field'::regclass
       and conname = 'template_field_source_key_fk'
  ) then
    alter table public.template_field
      add constraint template_field_source_key_fk
      foreign key (source_template_version_id, source_field_key)
      references public.template_field(template_version_id, field_key)
      on delete set null;
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.template_common_group'::regclass
       and conname = 'template_common_group_source_version_fk'
  ) then
    alter table public.template_common_group
      add constraint template_common_group_source_version_fk
      foreign key (source_template_version_id)
      references public.template_version(id) on delete set null;
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.template_common_group'::regclass
       and conname = 'template_common_group_source_key_fk'
  ) then
    alter table public.template_common_group
      add constraint template_common_group_source_key_fk
      foreign key (source_template_version_id, source_group_key)
      references public.template_common_group(template_version_id, group_key)
      on delete set null;
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.validation_rule'::regclass
       and conname = 'validation_rule_source_version_fk'
  ) then
    alter table public.validation_rule
      add constraint validation_rule_source_version_fk
      foreign key (source_template_version_id)
      references public.template_version(id) on delete set null;
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.validation_rule'::regclass
       and conname = 'validation_rule_source_rule_fk'
  ) then
    alter table public.validation_rule
      add constraint validation_rule_source_rule_fk
      foreign key (source_validation_rule_id)
      references public.validation_rule(id) on delete set null;
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.validation_rule'::regclass
       and conname = 'validation_rule_id_version_key'
  ) then
    alter table public.validation_rule
      add constraint validation_rule_id_version_key unique (id, template_version_id);
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.validation_rule'::regclass
       and conname = 'validation_rule_source_key_fk'
  ) then
    alter table public.validation_rule
      add constraint validation_rule_source_key_fk
      foreign key (source_validation_rule_id, source_template_version_id)
      references public.validation_rule(id, template_version_id)
      on delete set null;
  end if;
end
$$;

create unique index if not exists template_version_applied_operation_idx
  on public.template_version (applied_operation_id)
  where applied_operation_id is not null;

comment on column public.template_field.source_template_version_id is
  'Version structurelle immediate dont les metadonnees du champ ont ete recopiees.';
comment on column public.template_field.source_field_key is
  'Cle stable du champ source ; jamais une valeur patient.';
comment on column public.template_common_group.source_template_version_id is
  'Version source immediate du groupe commun UX-16.';
comment on column public.template_common_group.source_group_key is
  'Cle stable du groupe commun source.';
comment on column public.validation_rule.source_template_version_id is
  'Version source immediate de la regle recopiee.';
comment on column public.validation_rule.source_validation_rule_id is
  'Objet validation_rule source ; la regle cible reste dans validation_rule.';

-- Le contrat E1 etait deja installe sur la cible locale. On elargit la contrainte
-- existante au seul operation_kind E2, sans supprimer de donnees.
do $$
declare c record;
begin
  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.form_preparation_operation'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%operation_kind%'
  loop
    execute format('alter table public.form_preparation_operation drop constraint %I', c.conname);
  end loop;
end
$$;

alter table public.form_preparation_operation
  add constraint form_preparation_operation_kind_check
  check (operation_kind in ('save', 'preview', 'resume', 'discard', 'apply'));

-- -----------------------------------------------------------------------------
-- 2. Etat d'application ferme et autorisation de rattachement inter-gabarits
-- -----------------------------------------------------------------------------

create table public.form_preparation_application (
  owner_id                    uuid not null references public.profiles(id) on delete cascade,
  operation_id                uuid not null,
  preparation_id              uuid not null references public.form_preparation(id) on delete restrict,
  base_id                     uuid not null references public.base(id) on delete restrict,
  source_template_version_id  uuid not null references public.template_version(id) on delete restrict,
  target_template_version_id  uuid not null references public.template_version(id) on delete restrict,
  source_revision             bigint not null check (source_revision > 0),
  source_fingerprint          text not null check (source_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  content_fingerprint         text not null check (content_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  impact                      jsonb not null check (jsonb_typeof(impact) = 'object'),
  status                      text not null check (status in ('applying', 'applied')),
  transaction_id              bigint not null,
  created_at                  timestamptz not null default clock_timestamp(),
  completed_at                timestamptz,
  primary key (owner_id, operation_id),
  unique (preparation_id),
  constraint form_preparation_application_completion_check
    check ((status = 'applying' and completed_at is null)
       or (status = 'applied' and completed_at is not null))
);

create index form_preparation_application_base_idx
  on public.form_preparation_application (base_id, created_at desc);
create index form_preparation_application_target_idx
  on public.form_preparation_application (target_template_version_id);

alter table public.form_preparation_application enable row level security;
revoke all on table public.form_preparation_application from public, anon, authenticated;

comment on table public.form_preparation_application is
  'Contexte interne de rattachement E2 ; aucune lecture/ecriture directe par un role client.';

create or replace function public.form_preparation_rebind_allowed(
  p_base_id uuid,
  p_old_version_id uuid,
  p_new_version_id uuid
)
returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.form_preparation_application a
      join public.template_version target_version
        on target_version.id = a.target_template_version_id
      join public.template target_template
        on target_template.id = target_version.template_id
     where a.owner_id = auth.uid()
       and a.base_id = p_base_id
       and a.source_template_version_id = p_old_version_id
       and a.target_template_version_id = p_new_version_id
       and a.status = 'applying'
       and a.transaction_id = txid_current()
       and target_template.owner_user_id = auth.uid()
       and not target_template.is_global
       and a.operation_id::text = coalesce(current_setting('app.form_preparation_operation', true), '')
  )
$$;
revoke all on function public.form_preparation_rebind_allowed(uuid, uuid, uuid) from public, anon, authenticated;

-- Le garde historique reste la regle par defaut. Un changement de gabarit est
-- ouvert uniquement par le contexte interne cree par apply, avec base/source/
-- cible/acteur/transaction/operation tous concordants.
create or replace function public.guard_base_template_version()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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

  select template_id into v_old_tpl
    from public.template_version
   where id = old.current_template_version_id;
  if v_old_tpl is null then
    raise exception 'Version de jeu de variables source introuvable';
  end if;
  if v_new_tpl is distinct from v_old_tpl
     and not public.form_preparation_rebind_allowed(
       new.id, old.current_template_version_id, new.current_template_version_id) then
    raise exception 'Une base ne peut pointer que vers une version de SON propre jeu de variables (rattachement a un jeu de variables etranger interdit)';
  end if;
  return new;
end
$$;

drop trigger if exists trg_base_template_version on public.base;
create trigger trg_base_template_version
  before update on public.base
  for each row execute function public.guard_base_template_version();

-- -----------------------------------------------------------------------------
-- 3. Helpers de validation, impact et reçus E2
-- -----------------------------------------------------------------------------

create or replace function public.form_preparation_apply_text_array(p_value jsonb)
returns text[]
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then return null; end if;
  if jsonb_typeof(p_value) <> 'array'
     or exists (
       select 1 from jsonb_array_elements(p_value) e
        where jsonb_typeof(e.value) <> 'string'
     ) then
    raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_INVALID',
      detail = '{"code":"FORM_PREPARATION_INVALID","reason":"text_array_expected"}';
  end if;
  return array(select jsonb_array_elements_text(p_value));
end
$$;
revoke all on function public.form_preparation_apply_text_array(jsonb) from public, anon, authenticated;

create or replace function public.form_preparation_apply_assert_definition(
  p_source jsonb,
  p_candidate jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  item jsonb;
  v_section text;
  v_group text;
  v_source_field jsonb;
begin
  if jsonb_typeof(p_candidate) is distinct from 'object' then
    raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_INVALID',
      detail = '{"code":"FORM_PREPARATION_INVALID","reason":"definition_object_expected"}';
  end if;

  if jsonb_typeof(coalesce(p_candidate -> 'sections', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_candidate -> 'commonGroups', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_candidate -> 'fields', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_candidate -> 'rules', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_candidate -> 'diagnosisConfiguration', '[]'::jsonb)) <> 'array' then
    raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_INVALID',
      detail = '{"code":"FORM_PREPARATION_INVALID","reason":"definition_arrays_expected"}';
  end if;

  -- `form_preparation_normalize` a déjà vérifié les tableaux et les objets.
  -- Ces contrôles empêchent qu'une erreur de cast ou une contrainte interne
  -- devienne une réponse SQL brute pendant l'application.
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_candidate -> 'sections', '[]'::jsonb)) x(value)
     where coalesce(x.value ->> 'sectionKey', '') !~ '^[a-z][a-z0-9_]{0,62}$'
        or btrim(coalesce(x.value ->> 'label', '')) = ''
        or (x.value ? 'displayOrder' and jsonb_typeof(x.value -> 'displayOrder') <> 'number')
        or (x.value ? 'parentSectionKey'
            and jsonb_typeof(x.value -> 'parentSectionKey') not in ('string', 'null'))
  ) then
    raise exception using errcode = 'P0001', message = 'FORM_CHANGE_UNSUPPORTED',
      detail = '{"code":"FORM_CHANGE_UNSUPPORTED","reason":"section_shape"}';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(coalesce(p_candidate -> 'sections', '[]'::jsonb)) x(value)
     group by x.value ->> 'sectionKey' having count(*) > 1
  ) then
    raise exception using errcode = 'P0001', message = 'FORM_CHANGE_UNSUPPORTED',
      detail = '{"code":"FORM_CHANGE_UNSUPPORTED","reason":"duplicate_section_key"}';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(coalesce(p_candidate -> 'sections', '[]'::jsonb)) x(value)
     where x.value ->> 'parentSectionKey' is not null
       and not exists (
         select 1 from jsonb_array_elements(coalesce(p_candidate -> 'sections', '[]'::jsonb)) p(value)
          where p.value ->> 'sectionKey' = x.value ->> 'parentSectionKey'
            and p.value ->> 'parentSectionKey' is null
       )
  ) then
    raise exception using errcode = 'P0001', message = 'FORM_CHANGE_UNSUPPORTED',
      detail = '{"code":"FORM_CHANGE_UNSUPPORTED","reason":"section_parent_shape"}';
  end if;

  if exists (
    select 1 from jsonb_array_elements(coalesce(p_candidate -> 'commonGroups', '[]'::jsonb)) x(value)
     where coalesce(x.value ->> 'groupKey', '') !~ '^[a-z][a-z0-9_]{0,62}$'
        or btrim(coalesce(x.value ->> 'label', '')) = ''
        or (x.value ? 'displayOrder' and jsonb_typeof(x.value -> 'displayOrder') <> 'number')
        or (x.value ? 'anchorOrder' and jsonb_typeof(x.value -> 'anchorOrder') <> 'number')
        or (x.value ? 'isDefault' and jsonb_typeof(x.value -> 'isDefault') <> 'boolean')
  ) then
    raise exception using errcode = 'P0001', message = 'FORM_CHANGE_UNSUPPORTED',
      detail = '{"code":"FORM_CHANGE_UNSUPPORTED","reason":"common_group_shape"}';
  end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_candidate -> 'commonGroups', '[]'::jsonb)) x(value)
     group by x.value ->> 'groupKey' having count(*) > 1
  ) or (
    select count(*) from jsonb_array_elements(coalesce(p_candidate -> 'commonGroups', '[]'::jsonb)) x(value)
     where coalesce((x.value ->> 'isDefault')::boolean, false)
  ) > 1 then
    raise exception using errcode = 'P0001', message = 'FORM_CHANGE_UNSUPPORTED',
      detail = '{"code":"FORM_CHANGE_UNSUPPORTED","reason":"duplicate_common_group"}';
  end if;

  if exists (
    select 1 from jsonb_array_elements(coalesce(p_candidate -> 'fields', '[]'::jsonb)) x(value)
     where coalesce(x.value ->> 'fieldKey', '') !~ '^[a-z][a-z0-9_]{0,62}$'
        or btrim(coalesce(x.value ->> 'label', '')) = ''
        or coalesce(x.value ->> 'scope', '') not in ('patient', 'encounter')
        or coalesce(x.value ->> 'type', '') not in
           ('number','integer','text','date','datetime','boolean','select','multiselect','terminology')
        or (x.value ? 'required' and jsonb_typeof(x.value -> 'required') <> 'boolean')
        or (x.value ? 'allowMissingCodes' and jsonb_typeof(x.value -> 'allowMissingCodes') <> 'boolean')
        or (x.value ? 'isMultiple' and jsonb_typeof(x.value -> 'isMultiple') <> 'boolean')
        or (x.value ? 'encounterTypes' and jsonb_typeof(x.value -> 'encounterTypes') not in ('array','null'))
        or (x.value ? 'missingReasons' and jsonb_typeof(x.value -> 'missingReasons') not in ('array','null'))
        or (x.value ? 'allowedValues' and jsonb_typeof(x.value -> 'allowedValues') not in ('array','null'))
        or (x.value ? 'allowedOptions' and jsonb_typeof(x.value -> 'allowedOptions') not in ('array','null'))
        or (x.value ? 'minValue' and jsonb_typeof(x.value -> 'minValue') not in ('number','null'))
        or (x.value ? 'maxValue' and jsonb_typeof(x.value -> 'maxValue') not in ('number','null'))
  ) then
    raise exception using errcode = 'P0001', message = 'FORM_CHANGE_UNSUPPORTED',
      detail = '{"code":"FORM_CHANGE_UNSUPPORTED","reason":"field_shape"}';
  end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_candidate -> 'fields', '[]'::jsonb)) x(value)
     group by x.value ->> 'fieldKey' having count(*) > 1
  ) then
    raise exception using errcode = 'P0001', message = 'FORM_CHANGE_UNSUPPORTED',
      detail = '{"code":"FORM_CHANGE_UNSUPPORTED","reason":"duplicate_field_key"}';
  end if;

  for item in select value from jsonb_array_elements(coalesce(p_candidate -> 'fields', '[]'::jsonb)) loop
    v_section := nullif(item ->> 'sectionKey', '');
    v_group := nullif(item ->> 'commonGroupKey', '');
    if v_section is not null and not exists (
      select 1 from jsonb_array_elements(coalesce(p_candidate -> 'sections', '[]'::jsonb)) s(value)
       where s.value ->> 'sectionKey' = v_section
    ) then
      raise exception using errcode = 'P0001', message = 'FORM_CHANGE_UNSUPPORTED',
        detail = jsonb_build_object('code','FORM_CHANGE_UNSUPPORTED','reason','unknown_section','sectionKey',v_section)::text;
    end if;
    if v_section is not null and v_group is not null then
      raise exception using errcode = 'P0001', message = 'FORM_CHANGE_UNSUPPORTED',
        detail = '{"code":"FORM_CHANGE_UNSUPPORTED","reason":"field_has_two_locations"}';
    end if;
    if v_group is not null and not exists (
      select 1 from jsonb_array_elements(coalesce(p_candidate -> 'commonGroups', '[]'::jsonb)) g(value)
       where g.value ->> 'groupKey' = v_group
    ) then
      raise exception using errcode = 'FORM_CHANGE_UNSUPPORTED', message = 'FORM_CHANGE_UNSUPPORTED',
        detail = jsonb_build_object('code','FORM_CHANGE_UNSUPPORTED','reason','unknown_common_group','groupKey',v_group)::text;
    end if;
    if v_section is null and v_group is null and exists (
      select 1 from jsonb_array_elements(coalesce(p_candidate -> 'commonGroups', '[]'::jsonb)) g(value)
       where coalesce((g.value ->> 'isDefault')::boolean, false)
    ) then
      -- Le trigger UX-16 affectera le groupe par défaut si aucun groupe n'est
      -- fourni. C'est une organisation de présentation, pas une valeur.
      null;
    end if;

    v_source_field := null;
    select value into v_source_field
      from jsonb_array_elements(coalesce(p_source -> 'fields', '[]'::jsonb)) s(value)
     where s.value ->> 'fieldKey' = item ->> 'fieldKey';
    if v_source_field is null
       and item ? 'defaultValue'
       and item -> 'defaultValue' <> 'null'::jsonb
       and btrim(coalesce(item ->> 'defaultValue', '')) <> '' then
      raise exception using errcode = 'P0001', message = 'FORM_CHANGE_UNSUPPORTED',
        detail = jsonb_build_object('code','FORM_CHANGE_UNSUPPORTED','reason','new_field_default_forbidden','fieldKey',item ->> 'fieldKey')::text;
    end if;
  end loop;

  if exists (
    select 1 from jsonb_array_elements(coalesce(p_candidate -> 'rules', '[]'::jsonb)) x(value)
     where jsonb_typeof(x.value) <> 'object'
        or jsonb_typeof(x.value -> 'rule') <> 'object'
        or coalesce(x.value ->> 'severity', '') not in ('block','warn')
        or (x.value ? 'message' and jsonb_typeof(x.value -> 'message') not in ('string','null'))
  ) then
    raise exception using errcode = 'P0001', message = 'FORM_RULE_INVALID',
      detail = '{"code":"FORM_RULE_INVALID","reason":"rule_shape"}';
  end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_candidate -> 'diagnosisConfiguration', '[]'::jsonb)) x(value)
     where jsonb_typeof(x.value) <> 'object'
        or coalesce(x.value ->> 'scope', '') not in ('patient', 'encounter')
        or jsonb_typeof(x.value -> 'diagnosisFieldKey') <> 'string'
        or (x.value ? 'commonOnlyCodes'
            and jsonb_typeof(x.value -> 'commonOnlyCodes') not in ('array','null'))
        or (x.value ? 'commonOnlyCodes'
            and jsonb_typeof(x.value -> 'commonOnlyCodes') = 'array'
            and exists (
              select 1 from jsonb_array_elements(x.value -> 'commonOnlyCodes') code(value)
               where jsonb_typeof(code.value) <> 'string'
            ))
  ) then
    raise exception using errcode = 'P0001', message = 'FORM_RULE_INVALID',
      detail = '{"code":"FORM_RULE_INVALID","reason":"diagnosis_shape"}';
  end if;
end
$$;
revoke all on function public.form_preparation_apply_assert_definition(jsonb, jsonb) from public, anon, authenticated;

-- Le classifieur E1 reste la source des compteurs. Cette enveloppe ajoute la seule
-- transition qui change de sémantique d'applicabilité : une variable commune UX-16
-- qui rejoint un bloc clinique, ou l'inverse, n'est pas un simple déplacement visuel.
create or replace function public.form_preparation_apply_classify(
  p_source jsonb,
  p_candidate jsonb
)
returns jsonb
language plpgsql
immutable
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
  v_ux16_transitions integer := 0;
begin
  v_result := public.form_preparation_classify(p_source, p_candidate);
  select count(*)::integer into v_ux16_transitions
    from jsonb_array_elements(coalesce(p_candidate -> 'fields', '[]'::jsonb)) c(value)
    join jsonb_array_elements(coalesce(p_source -> 'fields', '[]'::jsonb)) s(value)
      on s.value ->> 'fieldKey' = c.value ->> 'fieldKey'
   where (nullif(s.value ->> 'sectionKey', '') is null)
         is distinct from
         (nullif(c.value ->> 'sectionKey', '') is null);

  if v_ux16_transitions > 0 then
    return v_result || jsonb_build_object(
      'classification', 'semantic',
      'code', 'FORM_SEMANTIC_MIGRATION_REQUIRED',
      'changed', coalesce((v_result ->> 'changed')::integer, 0) + v_ux16_transitions,
      'ux16Transitions', v_ux16_transitions
    );
  end if;
  return v_result || jsonb_build_object('ux16Transitions', 0);
end
$$;
revoke all on function public.form_preparation_apply_classify(jsonb, jsonb) from public, anon, authenticated;

create or replace function public.form_preparation_apply_impact(
  p_base_id uuid,
  p_source jsonb,
  p_candidate jsonb,
  p_classification jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_patient_count bigint;
  v_encounter_count bigint;
  v_added_fields jsonb;
  v_added_sections jsonb;
  v_added_groups jsonb;
  v_added_rules jsonb;
  v_added_diagnosis jsonb;
begin
  select count(*) into v_patient_count
    from public.patient p
   where p.base_id = p_base_id and p.deleted_at is null;
  select count(*) into v_encounter_count
    from public.encounter e
    join public.patient p on p.id = e.patient_id
   where p.base_id = p_base_id and p.deleted_at is null and e.deleted_at is null;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'fieldKey', c.value ->> 'fieldKey',
      'scope', c.value ->> 'scope',
      'required', coalesce((c.value ->> 'required')::boolean, false),
      'potentiallyAffectedRecords', case when c.value ->> 'scope' = 'patient'
        then v_patient_count else v_encounter_count end
    ) order by c.value ->> 'fieldKey'), '[]'::jsonb)
    into v_added_fields
    from jsonb_array_elements(coalesce(p_candidate -> 'fields', '[]'::jsonb)) c(value)
   where not exists (
     select 1 from jsonb_array_elements(coalesce(p_source -> 'fields', '[]'::jsonb)) s(value)
      where s.value ->> 'fieldKey' = c.value ->> 'fieldKey'
   );

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'sectionKey', c.value ->> 'sectionKey',
      'parentSectionKey', c.value ->> 'parentSectionKey'
    ) order by c.value ->> 'sectionKey'), '[]'::jsonb)
    into v_added_sections
    from jsonb_array_elements(coalesce(p_candidate -> 'sections', '[]'::jsonb)) c(value)
   where not exists (
     select 1 from jsonb_array_elements(coalesce(p_source -> 'sections', '[]'::jsonb)) s(value)
      where s.value ->> 'sectionKey' = c.value ->> 'sectionKey'
   );

  select coalesce(jsonb_agg(
    jsonb_build_object('groupKey', c.value ->> 'groupKey') order by c.value ->> 'groupKey'
  ), '[]'::jsonb)
    into v_added_groups
    from jsonb_array_elements(coalesce(p_candidate -> 'commonGroups', '[]'::jsonb)) c(value)
   where not exists (
     select 1 from jsonb_array_elements(coalesce(p_source -> 'commonGroups', '[]'::jsonb)) s(value)
      where s.value ->> 'groupKey' = c.value ->> 'groupKey'
   );

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'ruleFingerprint', public.form_preparation_fingerprint(c.value -> 'rule'),
      'severity', c.value ->> 'severity'
    ) order by public.form_preparation_fingerprint(c.value -> 'rule'), c.value ->> 'severity'
  ), '[]'::jsonb)
    into v_added_rules
    from jsonb_array_elements(coalesce(p_candidate -> 'rules', '[]'::jsonb)) c(value)
   where not exists (
     select 1 from jsonb_array_elements(coalesce(p_source -> 'rules', '[]'::jsonb)) s(value)
      where s.value = c.value
   );

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'scope', c.value ->> 'scope',
      'diagnosisFieldKey', c.value ->> 'diagnosisFieldKey',
      'commonOnlyCodeCount', case
        when jsonb_typeof(c.value -> 'commonOnlyCodes') = 'array'
          then jsonb_array_length(c.value -> 'commonOnlyCodes')
        else 0
      end,
      'potentiallyAffectedRecords', case when c.value ->> 'scope' = 'patient'
        then v_patient_count else v_encounter_count end
    ) order by c.value ->> 'scope', c.value ->> 'diagnosisFieldKey'
  ), '[]'::jsonb)
    into v_added_diagnosis
    from jsonb_array_elements(coalesce(p_candidate -> 'diagnosisConfiguration', '[]'::jsonb)) c(value)
   where not exists (
     select 1 from jsonb_array_elements(coalesce(p_source -> 'diagnosisConfiguration', '[]'::jsonb)) s(value)
      where s.value = c.value
   );

  return jsonb_build_object(
    'baseId', p_base_id,
    'classification', p_classification ->> 'classification',
    'classificationCounts', p_classification,
    'serverCounts', jsonb_build_object('patients', v_patient_count, 'encounters', v_encounter_count),
    'addedFields', v_added_fields,
    'addedSections', v_added_sections,
    'addedCommonGroups', v_added_groups,
    'addedRules', v_added_rules,
    'addedDiagnosisAssociations', v_added_diagnosis,
    'clinicalWrites', jsonb_build_object('patients', 0, 'encounters', 0, 'values', 0),
    'identityWrites', 0,
    'documentWrites', 0
  );
end
$$;
revoke all on function public.form_preparation_apply_impact(uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;

create or replace function public.form_preparation_apply_error_json(
  p_code text,
  p_preparation_id uuid,
  p_operation_id uuid,
  p_retryable boolean,
  p_details jsonb default '{}'::jsonb
)
returns jsonb
language sql
immutable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'code', p_code,
    'error', p_code,
    'preparationId', p_preparation_id,
    'operationId', p_operation_id,
    'retryable', p_retryable
  ) || coalesce(p_details, '{}'::jsonb)
$$;
revoke all on function public.form_preparation_apply_error_json(text, uuid, uuid, boolean, jsonb) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. RPC E2 : recalcul, copie, remappage et rattachement atomiques
-- -----------------------------------------------------------------------------

create or replace function public.apply_form_preparation(
  p_preparation_id uuid,
  p_expected_preparation_revision bigint,
  p_expected_source_revision bigint,
  p_expected_source_fingerprint text,
  p_operation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_row public.form_preparation;
  v_base public.base;
  v_source_version public.template_version;
  v_source_template public.template;
  v_source jsonb;
  v_candidate jsonb;
  v_source_fp text;
  v_content_fp text;
  v_hash text;
  v_existing jsonb;
  v_classification jsonb;
  v_impact jsonb;
  v_receipt jsonb;
  v_target_template_id uuid;
  v_target_version_id uuid;
  v_next_version int;
  v_target_base public.base;
  v_item jsonb;
  v_parent_key text;
  v_parent_id uuid;
  v_section_id uuid;
  v_group_id uuid;
  v_rule_id uuid;
  v_source_rule_id uuid;
  v_source_template_id uuid;
  v_source_field_exists boolean;
  v_source_section_exists boolean;
  v_source_group_exists boolean;
  v_target_is_new_template boolean := false;
begin
  if auth.uid() is null then
    raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_FORBIDDEN';
  end if;
  if p_preparation_id is null or p_expected_preparation_revision is null
     or p_expected_source_revision is null or p_expected_source_fingerprint is null
     or p_operation_id is null then
    raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_OPERATION_INVALID';
  end if;

  select * into v_row
    from public.form_preparation
   where id = p_preparation_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_NOT_FOUND';
  end if;
  perform public.form_preparation_assert_owner(v_row.base_id);
  -- Les mutations de préparation prennent toutes le verrou de base avant celui
  -- de la ligne de préparation. La première lecture est volontairement sans
  -- verrou : elle ne fait qu'identifier la base après le contrôle de droit.
  perform public.expire_form_preparations();

  v_hash := encode(digest(convert_to(jsonb_build_array(
    'apply', p_preparation_id, p_expected_preparation_revision,
    p_expected_source_revision, p_expected_source_fingerprint
  )::text, 'UTF8'), 'sha256'), 'hex');
  v_existing := public.form_preparation_operation_result(p_operation_id, v_hash);
  if v_existing is not null then return v_existing; end if;

  -- Le verrou de base rend le test de révision et le rattachement indivisibles.
  select * into v_base
    from public.base
   where id = v_row.base_id and deleted_at is null
   for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_FORBIDDEN';
  end if;
  if v_base.owner_user_id is distinct from auth.uid() or not public.is_medecin()
     or v_base.current_template_version_id is null then
    raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_FORBIDDEN';
  end if;
  select * into v_row
    from public.form_preparation
   where id = p_preparation_id
   for update;
  if not found or v_row.base_id is distinct from v_base.id then
    raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_CONFLICT';
  end if;

  if v_row.expires_at <= clock_timestamp()
     and v_row.state in ('active', 'ready', 'conflict') then
    update public.form_preparation
       set state = 'expired', payload = '{}'::jsonb, updated_at = clock_timestamp()
     where id = v_row.id
     returning * into v_row;
    raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_CLOSED';
  end if;
  if v_row.state = 'applied' then
    v_receipt := public.form_preparation_apply_error_json(
      'FORM_PREPARATION_CONFLICT', v_row.id, p_operation_id, true,
      jsonb_build_object('reason','already_applied','preparationState',v_row.state)
    );
    insert into public.form_preparation_operation
      (owner_id, operation_id, preparation_id, operation_kind, request_hash, receipt)
    values (auth.uid(), p_operation_id, v_row.id, 'apply', v_hash, v_receipt);
    insert into public.audit_log(user_id, action, entity, entity_id, base_id, metadata)
    values (auth.uid(), 'form_preparation_conflict', 'form_preparation', v_row.id, v_row.base_id,
      jsonb_build_object('operation_id',p_operation_id,'operation_kind','apply','reason','already_applied'));
    return v_receipt;
  end if;
  if v_row.state in ('discarded', 'expired') then
    raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_CLOSED';
  end if;
  if v_row.state = 'conflict' then
    v_receipt := public.form_preparation_apply_error_json(
      'FORM_PREPARATION_CONFLICT', v_row.id, p_operation_id, true,
      jsonb_build_object('reason','preparation_conflict','preparationState',v_row.state,'payloadPreserved',true)
    );
    insert into public.form_preparation_operation
      (owner_id, operation_id, preparation_id, operation_kind, request_hash, receipt)
    values (auth.uid(), p_operation_id, v_row.id, 'apply', v_hash, v_receipt);
    insert into public.audit_log(user_id, action, entity, entity_id, base_id, metadata)
    values (auth.uid(), 'form_preparation_conflict', 'form_preparation', v_row.id, v_row.base_id,
      jsonb_build_object('operation_id',p_operation_id,'operation_kind','apply','reason','preparation_conflict'));
    return v_receipt;
  end if;

  -- La source est verrouillee avant le fingerprint et avant toute copie. Les
  -- voies normales d'edition verrouillent aussi la version avant modification.
  select tv.* into v_source_version
    from public.template_version tv
   where tv.id = v_base.current_template_version_id
   for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_CONFLICT';
  end if;
  select * into v_source_template
    from public.template t
   where t.id = v_source_version.template_id
   for update;
  if not found or (not v_source_template.is_global
                   and v_source_template.owner_user_id is distinct from auth.uid()) then
    raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_FORBIDDEN';
  end if;

  v_source := public.form_preparation_source_definition(v_base.current_template_version_id);
  v_source_fp := public.form_preparation_fingerprint(v_source);
  if v_row.source_template_version_id is distinct from v_base.current_template_version_id
     or v_row.source_revision is distinct from v_base.form_revision
     or v_row.source_fingerprint is distinct from v_source_fp
     or p_expected_source_revision is distinct from v_base.form_revision
     or p_expected_source_fingerprint is distinct from v_source_fp
     or p_expected_preparation_revision is distinct from v_row.preparation_revision then
    update public.form_preparation
       set state = 'conflict', updated_at = clock_timestamp()
     where id = v_row.id
     returning * into v_row;
    v_receipt := public.form_preparation_apply_error_json(
      'FORM_PREPARATION_CONFLICT', v_row.id, p_operation_id, true,
      jsonb_build_object(
        'reason','revision_or_source_changed',
        'payloadPreserved',true,
        'currentSourceTemplateVersionId',v_base.current_template_version_id,
        'currentSourceRevision',v_base.form_revision,
        'currentSourceFingerprint',v_source_fp,
        'currentPreparationRevision',v_row.preparation_revision
      )
    );
    insert into public.form_preparation_operation
      (owner_id, operation_id, preparation_id, operation_kind, request_hash, receipt)
    values (auth.uid(), p_operation_id, v_row.id, 'apply', v_hash, v_receipt);
    insert into public.audit_log(user_id, action, entity, entity_id, base_id, metadata)
    values (auth.uid(), 'form_preparation_conflict', 'form_preparation', v_row.id, v_row.base_id,
      jsonb_build_object('operation_id',p_operation_id,'operation_kind','apply',
        'source_revision',v_base.form_revision,'source_fingerprint',v_source_fp,'payload_preserved',true));
    return v_receipt;
  end if;

  v_candidate := public.form_preparation_normalize(v_row.payload);
  v_content_fp := public.form_preparation_fingerprint(v_candidate);
  if v_row.content_fingerprint is distinct from v_content_fp then
    raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_INVALID',
      detail = '{"code":"FORM_PREPARATION_INVALID","reason":"content_fingerprint_mismatch"}';
  end if;
  perform public.form_preparation_apply_assert_definition(v_source, v_candidate);
  v_classification := public.form_preparation_apply_classify(v_source, v_candidate);
  v_impact := public.form_preparation_apply_impact(v_row.base_id, v_source, v_candidate, v_classification);

  if v_classification ->> 'classification' in ('semantic', 'unsupported') then
    update public.form_preparation
       set classification = coalesce(v_classification ->> 'classification', 'unsupported'),
           state = 'active', updated_at = clock_timestamp()
     where id = v_row.id
     returning * into v_row;
    v_receipt := public.form_preparation_apply_error_json(
      case when v_row.classification = 'semantic'
        then 'FORM_SEMANTIC_MIGRATION_REQUIRED' else 'FORM_CHANGE_UNSUPPORTED' end,
      v_row.id, p_operation_id, false,
      jsonb_build_object('classification',v_row.classification,'impact',v_impact,'payloadPreserved',true)
    );
    insert into public.form_preparation_operation
      (owner_id, operation_id, preparation_id, operation_kind, request_hash, receipt)
    values (auth.uid(), p_operation_id, v_row.id, 'apply', v_hash, v_receipt);
    insert into public.audit_log(user_id, action, entity, entity_id, base_id, metadata)
    values (auth.uid(), 'form_preparation_apply_refused', 'form_preparation', v_row.id, v_row.base_id,
      jsonb_build_object('operation_id',p_operation_id,'operation_kind','apply',
        'classification',v_row.classification,'payload_preserved',true));
    return v_receipt;
  end if;
  if v_row.state <> 'ready' then
    v_receipt := public.form_preparation_apply_error_json(
      'FORM_PREPARATION_NOT_READY', v_row.id, p_operation_id, false,
      jsonb_build_object('classification',v_classification ->> 'classification','impact',v_impact,'payloadPreserved',true)
    );
    insert into public.form_preparation_operation
      (owner_id, operation_id, preparation_id, operation_kind, request_hash, receipt)
    values (auth.uid(), p_operation_id, v_row.id, 'apply', v_hash, v_receipt);
    insert into public.audit_log(user_id, action, entity, entity_id, base_id, metadata)
    values (auth.uid(), 'form_preparation_apply_refused', 'form_preparation', v_row.id, v_row.base_id,
      jsonb_build_object('operation_id',p_operation_id,'operation_kind','apply','reason','not_ready'));
    return v_receipt;
  end if;

  -- Tous les inserts ci-dessous appartiennent a la meme transaction que le
  -- changement de base. Toute exception remonte et annule l'ensemble.
  begin
    if v_source_template.is_global
       or v_source_template.owner_user_id is distinct from auth.uid() then
      v_target_is_new_template := true;
      insert into public.template(name, specialty, owner_user_id, is_global)
      values (v_source_template.name, v_source_template.specialty, auth.uid(), false)
      returning id into v_target_template_id;
      v_next_version := 1;
    else
      v_target_template_id := v_source_template.id;
      select coalesce(max(version_number), 0) + 1 into v_next_version
        from public.template_version
       where template_id = v_target_template_id;
    end if;

    insert into public.template_version(
      template_id, version_number, status, created_by,
      derived_from_template_version_id, derived_from_preparation_id,
      derived_from_content_fingerprint, applied_operation_id, applied_at
    ) values (
      v_target_template_id, v_next_version, 'draft', auth.uid(),
      v_source_version.id, v_row.id, v_content_fp, p_operation_id, clock_timestamp()
    ) returning id into v_target_version_id;

    -- Les racines puis les sous-sections rendent le parent resolvable. La
    -- hierarchie demeure locale a la version cible.
    for v_item in
      select value from jsonb_array_elements(coalesce(v_candidate -> 'sections','[]'::jsonb)) x(value)
       where x.value ->> 'parentSectionKey' is null
       order by coalesce((x.value ->> 'displayOrder')::int, 0), x.value ->> 'sectionKey'
    loop
      select exists (select 1 from public.template_section where template_version_id = v_source_version.id and section_key = v_item ->> 'sectionKey')
        into v_source_section_exists;
      insert into public.template_section(
        template_version_id, section_key, label, display_order,
        source_template_version_id, source_section_key
      ) values (
        v_target_version_id, v_item ->> 'sectionKey', v_item ->> 'label',
        coalesce((v_item ->> 'displayOrder')::int, 0),
        case when v_source_section_exists then v_source_version.id else null end,
        case when v_source_section_exists then v_item ->> 'sectionKey' else null end
      );
    end loop;
    for v_item in
      select value from jsonb_array_elements(coalesce(v_candidate -> 'sections','[]'::jsonb)) x(value)
       where x.value ->> 'parentSectionKey' is not null
       order by coalesce((x.value ->> 'displayOrder')::int, 0), x.value ->> 'sectionKey'
    loop
      v_parent_key := v_item ->> 'parentSectionKey';
      select id into v_parent_id from public.template_section
       where template_version_id = v_target_version_id and section_key = v_parent_key;
      if v_parent_id is null then
        raise exception using errcode = 'P0001', message = 'FORM_CHANGE_UNSUPPORTED',
          detail = '{"code":"FORM_CHANGE_UNSUPPORTED","reason":"parent_not_copied"}';
      end if;
      select exists (select 1 from public.template_section where template_version_id = v_source_version.id and section_key = v_item ->> 'sectionKey')
        into v_source_section_exists;
      insert into public.template_section(
        template_version_id, section_key, label, display_order, parent_section_id,
        source_template_version_id, source_section_key
      ) values (
        v_target_version_id, v_item ->> 'sectionKey', v_item ->> 'label',
        coalesce((v_item ->> 'displayOrder')::int, 0), v_parent_id,
        case when v_source_section_exists then v_source_version.id else null end,
        case when v_source_section_exists then v_item ->> 'sectionKey' else null end
      );
    end loop;

    for v_item in
      select value from jsonb_array_elements(coalesce(v_candidate -> 'commonGroups','[]'::jsonb)) x(value)
       order by coalesce((x.value ->> 'displayOrder')::int, 0), x.value ->> 'groupKey'
    loop
      select exists (select 1 from public.template_common_group where template_version_id = v_source_version.id and group_key = v_item ->> 'groupKey')
        into v_source_group_exists;
      insert into public.template_common_group(
        template_version_id, group_key, label, display_order, anchor_order, is_default,
        source_template_version_id, source_group_key
      ) values (
        v_target_version_id, v_item ->> 'groupKey', v_item ->> 'label',
        coalesce((v_item ->> 'displayOrder')::int, 0),
        coalesce((v_item ->> 'anchorOrder')::int, 0),
        coalesce((v_item ->> 'isDefault')::boolean, false),
        case when v_source_group_exists then v_source_version.id else null end,
        case when v_source_group_exists then v_item ->> 'groupKey' else null end
      );
    end loop;

    perform set_config('app.setting_common_layout', 'on', true);
    for v_item in
      select value from jsonb_array_elements(coalesce(v_candidate -> 'fields','[]'::jsonb)) x(value)
       order by coalesce((x.value ->> 'displayOrder')::int, 0), x.value ->> 'fieldKey'
    loop
      v_section_id := null;
      v_group_id := null;
      if nullif(v_item ->> 'sectionKey', '') is not null then
        select id into v_section_id from public.template_section
         where template_version_id = v_target_version_id
           and section_key = v_item ->> 'sectionKey';
      elsif nullif(v_item ->> 'commonGroupKey', '') is not null then
        select id into v_group_id from public.template_common_group
         where template_version_id = v_target_version_id
           and group_key = v_item ->> 'commonGroupKey';
      else
        select id into v_group_id from public.template_common_group
         where template_version_id = v_target_version_id and is_default;
      end if;

      select exists (select 1 from public.template_field where template_version_id = v_source_version.id and field_key = v_item ->> 'fieldKey')
        into v_source_field_exists;
      insert into public.template_field(
        template_version_id, field_key, label, description, default_value,
        scope, section, section_id, type, is_multiple, unit, allowed_values,
        allowed_options, required, min_value, max_value, allow_missing_codes,
        missing_reasons, formula, display_order, encounter_types, common_group_id,
        source_template_version_id, source_field_key
      ) values (
        v_target_version_id,
        v_item ->> 'fieldKey',
        v_item ->> 'label',
        v_item ->> 'description',
        case when v_item -> 'defaultValue' is null or v_item -> 'defaultValue' = 'null'::jsonb then null else v_item ->> 'defaultValue' end,
        v_item ->> 'scope',
        case when v_section_id is null then null else v_item ->> 'sectionKey' end,
        v_section_id,
        v_item ->> 'type',
        coalesce((v_item ->> 'isMultiple')::boolean, false),
        v_item ->> 'unit',
        case when jsonb_typeof(v_item -> 'allowedValues') = 'null'
          then null else v_item -> 'allowedValues' end,
        case when jsonb_typeof(v_item -> 'allowedOptions') = 'null'
          then null else v_item -> 'allowedOptions' end,
        coalesce((v_item ->> 'required')::boolean, false),
        case when v_item -> 'minValue' is null or v_item -> 'minValue' = 'null'::jsonb then null else (v_item ->> 'minValue')::numeric end,
        case when v_item -> 'maxValue' is null or v_item -> 'maxValue' = 'null'::jsonb then null else (v_item ->> 'maxValue')::numeric end,
        coalesce((v_item ->> 'allowMissingCodes')::boolean, true),
        coalesce(public.form_preparation_apply_text_array(v_item -> 'missingReasons'), array['non_fait','inconnu','non_applicable']::text[]),
        nullif(v_item ->> 'formula', ''),
        coalesce((v_item ->> 'displayOrder')::int, 0),
        public.form_preparation_apply_text_array(v_item -> 'encounterTypes'),
        v_group_id,
        case when v_source_field_exists then v_source_version.id else null end,
        case when v_source_field_exists then v_item ->> 'fieldKey' else null end
      );
    end loop;

    for v_item in
      select value from jsonb_array_elements(coalesce(v_candidate -> 'rules','[]'::jsonb)) x(value)
       order by (x.value -> 'rule')::text, coalesce(x.value ->> 'message',''), x.value ->> 'severity'
    loop
      v_source_rule_id := null;
      select id into v_source_rule_id
        from public.validation_rule
       where template_version_id = v_source_version.id
         and jsonb_build_object('rule',rule,'message',message,'severity',severity) = v_item;
      insert into public.validation_rule(
        template_version_id, rule, message, severity,
        source_template_version_id, source_validation_rule_id
      ) values (
        v_target_version_id, v_item -> 'rule', v_item ->> 'message', v_item ->> 'severity',
        case when v_source_rule_id is null then null else v_source_version.id end,
        v_source_rule_id
      );
    end loop;

    update public.template_version
       set diagnosis_configuration = coalesce(v_candidate -> 'diagnosisConfiguration', '[]'::jsonb)
     where id = v_target_version_id;
    perform public.validate_template_version_invariants(v_target_version_id);

    -- Le contexte est cree juste avant la seule bascule de base. Il rend le
    -- rattachement cross-template possible pour un modele partage, mais ne
    -- donne aucun droit durable a une ecriture directe.
    insert into public.form_preparation_application(
      owner_id, operation_id, preparation_id, base_id,
      source_template_version_id, target_template_version_id,
      source_revision, source_fingerprint, content_fingerprint, impact,
      status, transaction_id
    ) values (
      auth.uid(), p_operation_id, v_row.id, v_row.base_id,
      v_source_version.id, v_target_version_id,
      v_base.form_revision, v_source_fp, v_content_fp, v_impact,
      'applying', txid_current()
    );
    perform set_config('app.form_preparation_operation', p_operation_id::text, true);
    update public.base
       set current_template_version_id = v_target_version_id
     where id = v_base.id;
    select * into v_target_base from public.base where id = v_base.id;
    update public.form_preparation_application
       set status = 'applied', completed_at = clock_timestamp()
     where owner_id = auth.uid() and operation_id = p_operation_id;

    update public.form_preparation
       set state = 'applied',
           classification = v_classification ->> 'classification',
           updated_at = clock_timestamp(),
           payload = '{}'::jsonb
     where id = v_row.id
     returning * into v_row;

    v_receipt := jsonb_build_object(
      'preparation', public.form_preparation_json(v_row),
      'operationId', p_operation_id,
      'operationKind', 'apply',
      'audit', jsonb_build_object(
        'sourceRevision', v_base.form_revision,
        'sourceFingerprint', v_source_fp,
        'contentFingerprint', v_content_fp,
        'preparationRevision', v_row.preparation_revision,
        'state', v_row.state,
        'classification', v_row.classification
      ),
      'impact', v_impact || jsonb_build_object('targetTemplateVersionId', v_target_version_id),
      'application', jsonb_build_object(
        'baseId', v_base.id,
        'sourceTemplateVersionId', v_source_version.id,
        'targetTemplateVersionId', v_target_version_id,
        'targetRevision', v_target_base.form_revision,
        'newTemplate', v_target_is_new_template
      )
    );
    insert into public.form_preparation_operation(
      owner_id, operation_id, preparation_id, operation_kind, request_hash, receipt
    ) values (
      auth.uid(), p_operation_id, v_row.id, 'apply', v_hash, v_receipt
    );
    insert into public.audit_log(user_id, action, entity, entity_id, base_id, metadata)
    values (auth.uid(), 'form_preparation_applied', 'form_preparation', v_row.id, v_row.base_id,
      jsonb_build_object(
        'operation_id', p_operation_id,
        'source_template_version_id', v_source_version.id,
        'target_template_version_id', v_target_version_id,
        'source_revision', v_base.form_revision,
        'target_revision', v_target_base.form_revision,
        'classification', v_row.classification,
        'impact', v_impact
      ));
    return v_receipt;
  exception
    when others then
      -- Le sous-bloc et la fonction globale sont transactionnels : aucune
      -- application partielle ne peut atteindre le commit. Ne jamais renvoyer
      -- le texte d'une contrainte ou une donnée interne au navigateur.
      if sqlerrm in (
        'FORM_PREPARATION_FORBIDDEN', 'FORM_PREPARATION_NOT_FOUND',
        'FORM_PREPARATION_OPERATION_INVALID', 'FORM_PREPARATION_CLOSED',
        'FORM_PREPARATION_CONFLICT', 'FORM_PREPARATION_INVALID',
        'FORM_CHANGE_UNSUPPORTED', 'FORM_RULE_INVALID',
        'FORM_SEMANTIC_MIGRATION_REQUIRED'
      ) then
        raise;
      end if;
      raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_APPLY_FAILED',
        detail = '{"code":"FORM_PREPARATION_APPLY_FAILED","retryable":true}';
  end;
end
$$;

revoke all on function public.apply_form_preparation(uuid, bigint, bigint, text, uuid) from public, anon;
grant execute on function public.apply_form_preparation(uuid, bigint, bigint, text, uuid) to authenticated;

-- Helpers internes fermes ; seule la façade apply est exposée à authenticated.
revoke all on function public.form_preparation_apply_impact(uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.form_preparation_apply_assert_definition(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.form_preparation_apply_text_array(jsonb) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5. Reprise de preview avec le même recalcul serveur que apply
-- -----------------------------------------------------------------------------
-- Cette redéfinition additive conserve le contrat E1 mais fait remonter l'impact
-- borné dès l'aperçu. Elle prend le verrou de base avant celui de la préparation,
-- comme save/apply, afin d'éviter un cycle de verrous entre une sauvegarde et une
-- application concurrentes.
create or replace function public.preview_form_preparation(
  p_preparation_id uuid,
  p_expected_preparation_revision bigint,
  p_expected_source_revision bigint,
  p_expected_source_fingerprint text,
  p_operation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_row public.form_preparation;
  v_base public.base;
  v_source jsonb;
  v_candidate jsonb;
  v_source_fp text;
  v_content_fp text;
  v_hash text;
  v_existing jsonb;
  v_classification jsonb;
  v_impact jsonb;
  v_receipt jsonb;
begin
  if p_preparation_id is null or p_expected_preparation_revision is null
     or p_expected_source_revision is null or p_expected_source_fingerprint is null
     or p_operation_id is null then
    raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_OPERATION_INVALID';
  end if;

  -- Première lecture sans verrou pour identifier la base après le contrôle de
  -- droit. Les écritures prennent ensuite base -> préparation, partout dans E2.
  select * into v_row from public.form_preparation where id = p_preparation_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_NOT_FOUND';
  end if;
  perform public.form_preparation_assert_owner(v_row.base_id);
  perform public.expire_form_preparations();

  v_hash := encode(digest(convert_to(jsonb_build_array('preview', p_preparation_id,
    p_expected_preparation_revision, p_expected_source_revision, p_expected_source_fingerprint)::text, 'UTF8'), 'sha256'), 'hex');
  v_existing := public.form_preparation_operation_result(p_operation_id, v_hash);
  if v_existing is not null then return v_existing; end if;

  select * into v_base
    from public.base
   where id = v_row.base_id and deleted_at is null
   for update;
  if not found or v_base.owner_user_id is distinct from auth.uid()
     or not public.is_medecin() or v_base.current_template_version_id is null then
    raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_FORBIDDEN';
  end if;
  select * into v_row from public.form_preparation where id = p_preparation_id for update;
  if not found or v_row.base_id is distinct from v_base.id then
    raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_CONFLICT';
  end if;

  v_source := public.form_preparation_source_definition(v_base.current_template_version_id);
  v_source_fp := public.form_preparation_fingerprint(v_source);
  if v_row.state in ('applied', 'discarded', 'expired') then
    raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_CLOSED';
  end if;

  if v_row.source_template_version_id is distinct from v_base.current_template_version_id
     or v_row.source_revision is distinct from v_base.form_revision
     or v_row.source_fingerprint is distinct from v_source_fp
     or p_expected_preparation_revision is distinct from v_row.preparation_revision
     or p_expected_source_revision is distinct from v_base.form_revision
     or p_expected_source_fingerprint is distinct from v_source_fp then
    update public.form_preparation
       set state = 'conflict', updated_at = clock_timestamp()
     where id = v_row.id
     returning * into v_row;
    v_receipt := public.form_preparation_apply_error_json(
      'FORM_PREPARATION_CONFLICT', v_row.id, p_operation_id, true,
      jsonb_build_object(
        'payloadPreserved', true,
        'currentSourceTemplateVersionId', v_base.current_template_version_id,
        'currentSourceRevision', v_base.form_revision,
        'currentSourceFingerprint', v_source_fp,
        'currentPreparationRevision', v_row.preparation_revision
      )
    );
  else
    v_candidate := public.form_preparation_normalize(v_row.payload);
    v_content_fp := public.form_preparation_fingerprint(v_candidate);
    if v_row.content_fingerprint is distinct from v_content_fp then
      raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_INVALID',
        detail = '{"code":"FORM_PREPARATION_INVALID","reason":"content_fingerprint_mismatch"}';
    end if;
    perform public.form_preparation_apply_assert_definition(v_source, v_candidate);
    v_classification := public.form_preparation_apply_classify(v_source, v_candidate);
    v_impact := public.form_preparation_apply_impact(v_row.base_id, v_source, v_candidate, v_classification);
    update public.form_preparation
       set state = case when v_classification ->> 'classification' in ('semantic','unsupported')
                   then 'active' else 'ready' end,
           classification = coalesce(v_classification ->> 'classification', 'unsupported'),
           updated_at = clock_timestamp()
     where id = v_row.id
     returning * into v_row;
    if v_row.classification in ('semantic', 'unsupported') then
      v_receipt := public.form_preparation_apply_error_json(
        case when v_row.classification = 'semantic'
          then 'FORM_SEMANTIC_MIGRATION_REQUIRED' else 'FORM_CHANGE_UNSUPPORTED' end,
        v_row.id, p_operation_id, false,
        jsonb_build_object(
          'classification', v_row.classification,
          'impact', v_impact,
          'payloadPreserved', true
        )
      );
    else
      v_receipt := public.form_preparation_receipt(v_row, p_operation_id, 'preview')
        || jsonb_build_object('impact', v_impact);
    end if;
  end if;

  insert into public.form_preparation_operation(
    owner_id, operation_id, preparation_id, operation_kind, request_hash, receipt
  ) values (auth.uid(), p_operation_id, v_row.id, 'preview', v_hash, v_receipt);
  insert into public.audit_log(user_id, action, entity, entity_id, base_id, metadata)
  values (auth.uid(), 'form_preparation_previewed', 'form_preparation', v_row.id, v_row.base_id,
    jsonb_build_object(
      'operation_id', p_operation_id,
      'state', v_row.state,
      'classification', v_row.classification,
      'source_revision', v_row.source_revision,
      'source_fingerprint', v_row.source_fingerprint,
      'preparation_revision', v_row.preparation_revision,
      'impact', coalesce(v_impact, '{}'::jsonb)
    ));
  return v_receipt;
end
$$;
revoke all on function public.preview_form_preparation(uuid, bigint, bigint, text, uuid) from public, anon;
grant execute on function public.preview_form_preparation(uuid, bigint, bigint, text, uuid) to authenticated;

-- Même ordre de verrous pour les deux autres mutations d'une préparation. Cela
-- ferme le cycle potentiel entre apply/preview (base -> préparation) et une
-- reprise ou un abandon concurrent (préparation -> base).
create or replace function public.resume_form_preparation(
  p_preparation_id uuid,
  p_expected_preparation_revision bigint,
  p_operation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_row public.form_preparation;
  v_base public.base;
  v_source jsonb;
  v_source_fp text;
  v_hash text;
  v_existing jsonb;
  v_receipt jsonb;
begin
  if p_preparation_id is null or p_expected_preparation_revision is null or p_operation_id is null then
    raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_OPERATION_INVALID';
  end if;
  select * into v_row from public.form_preparation where id = p_preparation_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_NOT_FOUND';
  end if;
  perform public.form_preparation_assert_owner(v_row.base_id);
  perform public.expire_form_preparations();
  v_hash := encode(digest(convert_to(jsonb_build_array('resume', p_preparation_id,
    p_expected_preparation_revision)::text, 'UTF8'), 'sha256'), 'hex');
  v_existing := public.form_preparation_operation_result(p_operation_id, v_hash);
  if v_existing is not null then return v_existing; end if;

  select * into v_base
    from public.base
   where id = v_row.base_id and deleted_at is null
   for update;
  if not found or v_base.owner_user_id is distinct from auth.uid()
     or not public.is_medecin() or v_base.current_template_version_id is null then
    raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_FORBIDDEN';
  end if;
  select * into v_row from public.form_preparation where id = p_preparation_id for update;
  if not found or v_row.base_id is distinct from v_base.id then
    raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_CONFLICT';
  end if;
  if v_row.state in ('applied', 'discarded', 'expired') then
    raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_CLOSED';
  end if;
  if p_expected_preparation_revision <> v_row.preparation_revision then
    raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_CONFLICT';
  end if;
  if v_row.state <> 'conflict' then
    raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_INVALID';
  end if;

  v_source := public.form_preparation_source_definition(v_base.current_template_version_id);
  v_source_fp := public.form_preparation_fingerprint(v_source);
  update public.form_preparation
     set source_template_version_id = v_base.current_template_version_id,
         source_revision = v_base.form_revision,
         source_fingerprint = v_source_fp,
         preparation_revision = preparation_revision + 1,
         state = 'active',
         updated_at = clock_timestamp(),
         expires_at = clock_timestamp() + interval '7 days'
   where id = v_row.id
   returning * into v_row;
  v_receipt := public.form_preparation_receipt(v_row, p_operation_id, 'resume');
  insert into public.form_preparation_operation(
    owner_id, operation_id, preparation_id, operation_kind, request_hash, receipt
  ) values (auth.uid(), p_operation_id, v_row.id, 'resume', v_hash, v_receipt);
  insert into public.audit_log(user_id, action, entity, entity_id, base_id, metadata)
  values (auth.uid(), 'form_preparation_resumed', 'form_preparation', v_row.id, v_row.base_id,
    jsonb_build_object(
      'operation_id', p_operation_id,
      'state', v_row.state,
      'source_revision', v_row.source_revision,
      'source_fingerprint', v_row.source_fingerprint,
      'preparation_revision', v_row.preparation_revision
    ));
  return v_receipt;
end
$$;
revoke all on function public.resume_form_preparation(uuid, bigint, uuid) from public, anon;
grant execute on function public.resume_form_preparation(uuid, bigint, uuid) to authenticated;

create or replace function public.discard_form_preparation(
  p_preparation_id uuid,
  p_expected_preparation_revision bigint,
  p_expected_source_revision bigint,
  p_expected_source_fingerprint text,
  p_operation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_row public.form_preparation;
  v_base public.base;
  v_source jsonb;
  v_source_fp text;
  v_hash text;
  v_existing jsonb;
  v_receipt jsonb;
begin
  if p_preparation_id is null or p_expected_preparation_revision is null
     or p_expected_source_revision is null or p_expected_source_fingerprint is null
     or p_operation_id is null then
    raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_OPERATION_INVALID';
  end if;
  select * into v_row from public.form_preparation where id = p_preparation_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_NOT_FOUND';
  end if;
  perform public.form_preparation_assert_owner(v_row.base_id);
  perform public.expire_form_preparations();
  v_hash := encode(digest(convert_to(jsonb_build_array('discard', p_preparation_id,
    p_expected_preparation_revision, p_expected_source_revision,
    p_expected_source_fingerprint)::text, 'UTF8'), 'sha256'), 'hex');
  v_existing := public.form_preparation_operation_result(p_operation_id, v_hash);
  if v_existing is not null then return v_existing; end if;

  select * into v_base
    from public.base
   where id = v_row.base_id and deleted_at is null
   for update;
  if not found or v_base.owner_user_id is distinct from auth.uid()
     or not public.is_medecin() or v_base.current_template_version_id is null then
    raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_FORBIDDEN';
  end if;
  select * into v_row from public.form_preparation where id = p_preparation_id for update;
  if not found or v_row.base_id is distinct from v_base.id then
    raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_CONFLICT';
  end if;
  if v_row.state in ('applied', 'discarded', 'expired') then
    raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_CLOSED';
  end if;
  if p_expected_preparation_revision <> v_row.preparation_revision then
    raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_CONFLICT';
  end if;

  v_source := public.form_preparation_source_definition(v_base.current_template_version_id);
  v_source_fp := public.form_preparation_fingerprint(v_source);
  if p_expected_source_revision is distinct from v_base.form_revision
     or p_expected_source_fingerprint is distinct from v_source_fp then
    update public.form_preparation
       set state = 'conflict', updated_at = clock_timestamp()
     where id = v_row.id
     returning * into v_row;
    v_receipt := public.form_preparation_error_json(
      'FORM_PREPARATION_CONFLICT', v_row.id, p_operation_id, true
    );
    insert into public.form_preparation_operation(
      owner_id, operation_id, preparation_id, operation_kind, request_hash, receipt
    ) values (auth.uid(), p_operation_id, v_row.id, 'discard', v_hash, v_receipt);
    insert into public.audit_log(user_id, action, entity, entity_id, base_id, metadata)
    values (auth.uid(), 'form_preparation_conflict', 'form_preparation', v_row.id, v_row.base_id,
      jsonb_build_object('operation_id', p_operation_id, 'operation_kind', 'discard', 'retryable', true));
    return v_receipt;
  end if;

  update public.form_preparation
     set state = 'discarded', payload = '{}', updated_at = clock_timestamp()
   where id = v_row.id
   returning * into v_row;
  v_receipt := public.form_preparation_receipt(v_row, p_operation_id, 'discard');
  insert into public.form_preparation_operation(
    owner_id, operation_id, preparation_id, operation_kind, request_hash, receipt
  ) values (auth.uid(), p_operation_id, v_row.id, 'discard', v_hash, v_receipt);
  insert into public.audit_log(user_id, action, entity, entity_id, base_id, metadata)
  values (auth.uid(), 'form_preparation_discarded', 'form_preparation', v_row.id, v_row.base_id,
    jsonb_build_object(
      'operation_id', p_operation_id,
      'state', v_row.state,
      'source_revision', v_row.source_revision,
      'source_fingerprint', v_row.source_fingerprint,
      'preparation_revision', v_row.preparation_revision
    ));
  return v_receipt;
end
$$;
revoke all on function public.discard_form_preparation(uuid, bigint, bigint, text, uuid) from public, anon;
grant execute on function public.discard_form_preparation(uuid, bigint, bigint, text, uuid) to authenticated;
