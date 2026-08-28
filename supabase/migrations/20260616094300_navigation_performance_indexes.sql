-- =============================================================================
-- 20260616094300_navigation_performance_indexes.sql
-- Index de navigation : alignes avec les listes et chargements les plus frequents.
-- =============================================================================

-- BaseHome / listPatientsPage : filtre base_id + deleted_at, ordre created_at, pagination.
create index if not exists ix_patient_base_created_active
  on public.patient (base_id, created_at, id)
  where deleted_at is null;

-- PatientDetail : rencontres d'un patient non supprimees, ordonnees par date.
create index if not exists ix_encounter_patient_date_active
  on public.encounter (patient_id, encounter_date, id)
  where deleted_at is null;

-- Dashboard/getBase : acces actifs par utilisateur/base.
create index if not exists ix_base_access_user_active
  on public.base_access (user_id, base_id)
  where revoked_at is null;

-- Chargement leger des colonnes de gabarit.
create index if not exists ix_template_field_version_order
  on public.template_field (template_version_id, display_order, id);

-- Recherche de doublon d'identite dans la saisie patient.
create index if not exists ix_identity_base_dob_name_active
  on public.patient_identity (base_id, date_of_birth, (lower(full_name)))
  where deleted_at is null;
