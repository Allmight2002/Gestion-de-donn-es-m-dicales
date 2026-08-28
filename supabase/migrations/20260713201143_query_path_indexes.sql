-- Indexes derived from the actual read paths:
--   patients.listFieldChanges: equality on entity/entity_id, newest first;
--   exports.listExports: equality on cohort_id, newest first;
--   encounter FK maintenance: clinical_attachment.encounter_id is nullable
--   and uses ON DELETE SET NULL, so index only the referenced rows.

create index if not exists ix_field_change_log_entity_history
  on public.field_change_log (entity, entity_id, changed_at desc);

create index if not exists ix_export_log_cohort_history
  on public.export_log (cohort_id, exported_at desc);

create index if not exists ix_clinical_attachment_encounter
  on public.clinical_attachment (encounter_id)
  where encounter_id is not null;
