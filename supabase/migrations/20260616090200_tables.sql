-- =============================================================================
-- 20260616090200_tables.sql  (v3.0)
-- Modele de donnees (cahier technique v3.0 §6).
--
-- Trois zones (§3.3) : IDENTITE restreinte · DOCUMENTS BRUTS tres restreints
-- (sous-systeme curation, migration dediee) · ANALYTIQUE sous code patient.
-- Patient + rencontres au centre ; double parcours (saisie directe / curation).
--
-- Cette migration definit les tables de la FONDATION (hors sous-systeme curation,
-- qui est ajoute par une migration ulterieure). clinical_attachment remplace
-- l'ancienne table attachment.
-- =============================================================================

-- profiles : lie a auth.users. global_role = system_admin | medecin | curateur |
-- validateur | analyste. Le medecin (auto a l'inscription) cree/possede des bases ;
-- curateur/validateur/analyste sont des roles STAFF attribues par l'admin systeme.
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null default '',
  global_role text not null default 'medecin' check (global_role in ('system_admin','medecin','curateur')),
  language    text not null default 'fr',
  created_at  timestamptz not null default now()
);

-- gabarits ----------------------------------------------------------------------
-- gabarits : modeles GLOBAUX (is_global, officiels, proposes a tous, geres par l'admin)
-- ou PERSONNELS (owner_user_id = medecin). A la creation d'une base, un modele est COPIE
-- en gabarit personnel editable librement (cahier v3.0 ; plus d'immuabilite).
create table public.template (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  specialty     text,
  owner_user_id uuid references public.profiles(id) on delete set null,
  is_global     boolean not null default false,
  created_at    timestamptz not null default now()
);

create table public.template_version (
  id              uuid primary key default gen_random_uuid(),
  template_id     uuid not null references public.template(id) on delete cascade,
  version_number  int  not null,
  status          text not null default 'draft' check (status in ('draft','published','archived')),
  created_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  published_at    timestamptz,
  unique (template_id, version_number)
);

create table public.template_field (
  id                  uuid primary key default gen_random_uuid(),
  template_version_id uuid not null references public.template_version(id) on delete cascade,
  field_key           text not null,
  label               text not null,
  scope               text not null check (scope in ('patient','encounter')),
  section             text not null check (section in ('clinique','biologie','paraclinique')),
  type                text not null check (type in ('number','integer','text','date','datetime','boolean','select','multiselect')),
  unit                text,
  allowed_values      jsonb,
  required            boolean not null default false,
  min_value           numeric,
  max_value           numeric,
  allow_missing_codes boolean not null default true,
  display_order       int not null default 0,
  unique (template_version_id, field_key)
);

create table public.validation_rule (
  id                  uuid primary key default gen_random_uuid(),
  template_version_id uuid not null references public.template_version(id) on delete cascade,
  rule                jsonb not null,
  message             text,
  severity            text not null default 'block' check (severity in ('block','warn'))
);

-- base : registre. + suppression logique (deleted_at).
create table public.base (
  id                          uuid primary key default gen_random_uuid(),
  name                        text not null,
  specialty                   text,
  owner_user_id               uuid not null references public.profiles(id),
  current_template_version_id uuid references public.template_version(id),
  created_at                  timestamptz not null default now(),
  deleted_at                  timestamptz
);

-- Invitations & acces : 6 permissions granulaires (§4.3). Token jamais en clair.
create table public.base_invitation (
  id                       uuid primary key default gen_random_uuid(),
  base_id                  uuid not null references public.base(id) on delete cascade,
  invited_email            text not null,
  access_role              text not null check (access_role in ('viewer','editor')),
  can_view_identity        boolean not null default false,
  can_view_raw_documents   boolean not null default false,
  can_edit_structured_data boolean not null default false,
  can_validate_data        boolean not null default false,
  can_export_data          boolean not null default false,
  can_manage_access        boolean not null default false,
  token_hash               text not null unique,
  status                   text not null default 'pending' check (status in ('pending','accepted','expired','revoked')),
  expires_at               timestamptz not null,
  invited_by               uuid references public.profiles(id),
  created_at               timestamptz not null default now()
);

create table public.base_access (
  id                       uuid primary key default gen_random_uuid(),
  base_id                  uuid not null references public.base(id) on delete cascade,
  user_id                  uuid not null references public.profiles(id) on delete cascade,
  access_role              text not null check (access_role in ('viewer','editor')),
  can_view_identity        boolean not null default false,
  can_view_raw_documents   boolean not null default false,
  can_edit_structured_data boolean not null default false,
  can_validate_data        boolean not null default false,
  can_export_data          boolean not null default false,
  can_manage_access        boolean not null default false,
  granted_by               uuid references public.profiles(id),
  created_at               timestamptz not null default now(),
  revoked_at               timestamptz,
  unique (base_id, user_id)
);

-- ZONE RESTREINTE : identite. full_name nullable (patient minimal §7.1).
create table public.patient_identity (
  id                            uuid primary key default gen_random_uuid(),
  base_id                       uuid not null references public.base(id) on delete cascade,
  patient_code                  text not null,
  full_name                     text,
  date_of_birth                 date,
  phone                         text,
  address                       text,
  external_identifier           text,
  created_by                    uuid references public.profiles(id),
  created_at                    timestamptz not null default now(),
  deleted_at                    timestamptz,
  deleted_by                    uuid references public.profiles(id),
  deletion_reason               text
);
create unique index uq_identity_base_code
  on public.patient_identity (base_id, patient_code) where deleted_at is null;

-- ZONE ANALYTIQUE : patient (donnees PERMANENTES) + mode de collecte + validation.
create table public.patient (
  id                  uuid primary key default gen_random_uuid(),
  base_id             uuid not null references public.base(id) on delete cascade,
  patient_code        text not null,
  template_version_id uuid not null references public.template_version(id),
  data                jsonb not null default '{}'::jsonb,
  collection_mode     text not null default 'direct' check (collection_mode in ('direct','assisted','mixed')),
  validation_status   text not null default 'draft' check (validation_status in ('draft','complete','curated')),
  created_by          uuid references public.profiles(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  deleted_by          uuid references public.profiles(id),
  deletion_reason     text
);
create unique index uq_patient_base_code
  on public.patient (base_id, patient_code) where deleted_at is null;
create index ix_patient_base on public.patient (base_id);
create index ix_patient_data_gin on public.patient using gin (data jsonb_path_ops);

-- rencontres. age_value/age_unit en COLONNES (§5.2) ; validation_status (v3.0).
create table public.encounter (
  id                  uuid primary key default gen_random_uuid(),
  patient_id          uuid not null references public.patient(id) on delete cascade,
  template_version_id uuid not null references public.template_version(id),
  encounter_type      text not null check (encounter_type in ('consultation','hospitalisation','suivi','autre')),
  encounter_date      date not null,
  age_value           numeric,
  age_unit            text check (age_unit in ('days','months','years')),
  data                jsonb not null default '{}'::jsonb,
  collection_mode     text not null default 'direct' check (collection_mode in ('direct','assisted','mixed')),
  validation_status   text not null default 'draft' check (validation_status in ('draft','complete','curated')),
  created_by          uuid references public.profiles(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  deleted_by          uuid references public.profiles(id),
  deletion_reason     text
);
create index ix_encounter_patient on public.encounter (patient_id);
create index ix_encounter_data_gin on public.encounter using gin (data jsonb_path_ops);

-- historique des corrections (+ source v3.0). base_id ajoute pour scoper la RLS.
create table public.field_change_log (
  id         uuid primary key default gen_random_uuid(),
  base_id    uuid references public.base(id) on delete cascade,
  entity     text not null check (entity in ('patient','encounter')),
  entity_id  uuid not null,
  field_key  text not null,
  old_value  jsonb,
  new_value  jsonb,
  changed_by uuid references public.profiles(id),
  reason     text,
  source     text not null default 'direct_entry' check (source in ('direct_entry','curation_validation','curation_finalization','manual_correction')),
  changed_at timestamptz not null default now()
);

-- PIECES JOINTES CLINIQUES (zone restreinte, jamais exportees) — ex-"attachment".
-- Distinctes des documents bruts de curation (migration dediee).
create table public.clinical_attachment (
  id                        uuid primary key default gen_random_uuid(),
  patient_id                uuid not null references public.patient(id) on delete cascade,
  encounter_id              uuid references public.encounter(id) on delete set null,
  kind                      text,
  label                     text,
  storage_path              text not null,
  mime_type                 text,
  -- Inspection a l'upload (§5.3) : type reel detecte (magic bytes), taille, empreinte.
  -- 'accepted_client' = controle navigateur passe ; 'accepted'/'quarantined' = verdict
  -- d'un scan serveur (antivirus) a venir. Defense en profondeur, attestee cote client.
  detected_mime_type        text,
  file_size                 bigint,
  file_hash                 text,
  inspection_status         text not null default 'accepted_client'
    check (inspection_status in ('pending','accepted_client','accepted','quarantined')),
  inspected_at              timestamptz,
  deidentification_confirmed boolean not null default false,
  created_by                uuid references public.profiles(id),
  created_at                timestamptz not null default now(),
  deleted_at                timestamptz,
  deleted_by                uuid references public.profiles(id),
  deletion_reason           text,
  -- Pas d'image clinique conservee sans confirmation de de-identification (§12).
  constraint clinical_attachment_deid_required check (deidentification_confirmed = true)
);
create index ix_clinical_attachment_patient on public.clinical_attachment (patient_id);

-- cohortes (dynamique / figee patient+rencontre) + validated_only (§15.1).
create table public.cohort (
  id                uuid primary key default gen_random_uuid(),
  base_id           uuid not null references public.base(id) on delete cascade,
  name              text not null,
  filter_definition jsonb not null default '{}'::jsonb,
  cohort_type       text not null default 'dynamic' check (cohort_type in ('dynamic','snapshot')),
  snapshot_at       timestamptz,
  validated_only    boolean not null default true,
  created_by        uuid references public.profiles(id),
  created_at        timestamptz not null default now()
);

create table public.cohort_member (
  cohort_id   uuid not null references public.cohort(id) on delete cascade,
  patient_id  uuid not null references public.patient(id) on delete cascade,
  included_at timestamptz not null default now(),
  primary key (cohort_id, patient_id)
);

create table public.cohort_encounter_member (
  cohort_id    uuid not null references public.cohort(id) on delete cascade,
  encounter_id uuid not null references public.encounter(id) on delete cascade,
  included_at  timestamptz not null default now(),
  primary key (cohort_id, encounter_id)
);

-- trace d'export immuable (+ template_versions jsonb v3.0).
create table public.export_log (
  id               uuid primary key default gen_random_uuid(),
  cohort_id        uuid not null references public.cohort(id) on delete cascade,
  exported_by      uuid references public.profiles(id),
  exported_at      timestamptz not null default now(),
  format           text not null check (format in ('xlsx','csv')),
  export_options   jsonb not null default '{}'::jsonb,
  patient_count    int,
  encounter_count  int,
  stored_file_path text,
  file_hash        text,
  template_versions jsonb
);

-- audit renforce (metadata jsonb ; jamais de contenu clinique en clair §6.7).
create table public.audit_log (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references public.profiles(id),
  action     text not null,
  entity     text,
  entity_id  uuid,
  base_id    uuid references public.base(id) on delete set null,
  metadata   jsonb,
  created_at timestamptz not null default now()
);
