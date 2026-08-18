# Schéma — état final (GÉNÉRÉ, ne pas éditer)

> Document **généré** par `npm run schema` : il montre l'état RÉSULTANT de toutes les
> migrations (forward-only) sans avoir à les rejouer de tête. À régénérer après chaque
> nouvelle migration — `npm run manifest` signale s'il est en retard.

- Dernière migration incluse : `20260818045033_multivalue_terminology_foundation.sql`
- Tables : 42 · Policies RLS : 63 · Triggers : 63 · Fonctions : 261

## Tables (colonnes, RLS, policies, triggers)

### app_security_setting · RLS activée

| Colonne | Type | Nullable | Défaut |
|---|---|---|---|
| key | text | non |  |
| value | text | non |  |
| updated_at | timestamp with time zone | non | `now()` |

Policies : *(aucune — table fermée aux clients, écrite par RPC/serveur seulement)*

### audit_log · RLS activée

| Colonne | Type | Nullable | Défaut |
|---|---|---|---|
| id | uuid | non | `gen_random_uuid()` |
| user_id | uuid | oui |  |
| action | text | non |  |
| entity | text | oui |  |
| entity_id | uuid | oui |  |
| base_id | uuid | oui |  |
| metadata | jsonb | oui |  |
| created_at | timestamp with time zone | non | `now()` |

Policies :
- `al_select` (SELECT) — USING ((user_id = auth.uid()) OR ((base_id IS NOT NULL) AND is_base_owner(base_id)) OR (is_system_admin() AND (base_id IS NULL)))

### base · RLS activée

| Colonne | Type | Nullable | Défaut |
|---|---|---|---|
| id | uuid | non | `gen_random_uuid()` |
| name | text | non |  |
| specialty | text | oui |  |
| owner_user_id | uuid | non |  |
| current_template_version_id | uuid | oui |  |
| created_at | timestamp with time zone | non | `now()` |
| deleted_at | timestamp with time zone | oui |  |
| deleted_by | uuid | oui |  |
| deletion_reason | text | oui |  |
| inclusion_target | integer | oui |  |
| inclusion_target_date | date | oui |  |
| inclusion_target_revision | bigint | non | `0` |
| deletion_snapshot | jsonb | oui |  |
| observation_model | text | non | `'longitudinal'::text` |

Policies :
- `base_insert` (INSERT) — WITH CHECK ((owner_user_id = auth.uid()) AND is_medecin())
- `base_select` (SELECT) — USING ((deleted_at IS NULL) AND (is_medecin() OR is_saisisseur()) AND ((owner_user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM base_access ba
  WHERE ((ba.base_id = base.id) AND (ba.user_id = auth.uid()) AND (ba.revoked_at IS NULL) AND ((ba.expires_at IS NULL) OR (ba.expires_at > now())))))))
- `base_update` (UPDATE) — USING is_base_owner(id) · WITH CHECK is_base_owner(id)

Triggers :
- `trg_base_observation_model` — BEFORE INSERT/UPDATE → `enforce_observation_model_on_base()`
- `trg_base_owner_immutable` — BEFORE UPDATE → `guard_base_owner_immutable()`
- `trg_base_template_version` — BEFORE UPDATE → `guard_base_template_version()`
- `trg_guard_base_inclusion_target_revision` — BEFORE UPDATE → `guard_base_inclusion_target_revision()`

### base_access · RLS activée

| Colonne | Type | Nullable | Défaut |
|---|---|---|---|
| id | uuid | non | `gen_random_uuid()` |
| base_id | uuid | non |  |
| user_id | uuid | non |  |
| access_role | text | non |  |
| can_view_identity | boolean | non | `false` |
| can_view_raw_documents | boolean | non | `false` |
| can_edit_structured_data | boolean | non | `false` |
| can_export_data | boolean | non | `false` |
| can_manage_access | boolean | non | `false` |
| granted_by | uuid | oui |  |
| created_at | timestamp with time zone | non | `now()` |
| revoked_at | timestamp with time zone | oui |  |
| expires_at | timestamp with time zone | oui |  |
| can_create_structured_data | boolean | non | `false` |
| identity_justification | text | oui |  |

Policies :
- `ba_select` (SELECT) — USING ((user_id = auth.uid()) OR is_base_owner(base_id) OR can_manage_access(base_id))

Triggers :
- `trg_audit_access` — AFTER INSERT/UPDATE → `trg_audit_access_fn()`
- `trg_base_access_escalation` — BEFORE INSERT/UPDATE → `guard_access_escalation()`
- `trg_guard_base_access_medecin` — BEFORE INSERT/UPDATE → `guard_base_access_medecin()`

### base_invitation · RLS activée

| Colonne | Type | Nullable | Défaut |
|---|---|---|---|
| id | uuid | non | `gen_random_uuid()` |
| base_id | uuid | non |  |
| invited_email | text | non |  |
| access_role | text | non |  |
| can_view_identity | boolean | non | `false` |
| can_view_raw_documents | boolean | non | `false` |
| can_edit_structured_data | boolean | non | `false` |
| can_export_data | boolean | non | `false` |
| can_manage_access | boolean | non | `false` |
| token_hash | text | non |  |
| status | text | non | `'pending'::text` |
| expires_at | timestamp with time zone | non |  |
| invited_by | uuid | oui |  |
| created_at | timestamp with time zone | non | `now()` |

Policies :
- `bi_select` (SELECT) — USING (is_base_active(base_id) AND (is_base_owner(base_id) OR can_manage_access(base_id) OR (invited_by = auth.uid())))

Triggers :
- `trg_audit_invitation` — AFTER INSERT → `trg_audit_invitation_fn()`
- `trg_base_invitation_escalation` — BEFORE INSERT/UPDATE → `guard_access_escalation()`

### client_error_log · RLS activée

| Colonne | Type | Nullable | Défaut |
|---|---|---|---|
| id | uuid | non | `gen_random_uuid()` |
| occurred_at | timestamp with time zone | non |  |
| received_at | timestamp with time zone | non | `now()` |
| last_occurred_at | timestamp with time zone | non |  |
| user_id | uuid | oui |  |
| error_name | text | non |  |
| error_message | text | non |  |
| stack | text | oui |  |
| component_stack | text | oui |  |
| context | text | non |  |
| app_version | text | oui |  |
| severity | text | non |  |
| fingerprint | text | non |  |
| occurrence_count | integer | non | `1` |
| source | text | non | `'web'::text` |
| notified_at | timestamp with time zone | oui |  |

Policies :
- `client_error_log_select_system_admin` (SELECT) — USING is_system_admin()

### clinical_attachment · RLS activée

| Colonne | Type | Nullable | Défaut |
|---|---|---|---|
| id | uuid | non | `gen_random_uuid()` |
| patient_id | uuid | non |  |
| encounter_id | uuid | oui |  |
| kind | text | oui |  |
| label | text | oui |  |
| storage_path | text | non |  |
| mime_type | text | oui |  |
| detected_mime_type | text | oui |  |
| file_size | bigint | oui |  |
| file_hash | text | oui |  |
| inspection_status | text | non | `'accepted_client'::text` |
| inspected_at | timestamp with time zone | oui |  |
| deidentification_confirmed | boolean | non | `false` |
| created_by | uuid | oui |  |
| created_at | timestamp with time zone | non | `now()` |
| deleted_at | timestamp with time zone | oui |  |
| deleted_by | uuid | oui |  |
| deletion_reason | text | oui |  |
| inspection_run_id | uuid | oui |  |
| inspection_started_at | timestamp with time zone | oui |  |
| inspection_attempt_count | integer | non | `0` |
| last_inspection_attempt_at | timestamp with time zone | oui |  |
| last_inspection_error | text | oui |  |
| quarantine_bucket | text | oui |  |
| quarantine_path | text | oui |  |
| quarantined_at | timestamp with time zone | oui |  |
| upload_ticket_id | uuid | oui |  |

Policies :
- `ca_insert` (INSERT) — WITH CHECK (is_medecin() AND can_write_identity(base_of_patient(patient_id)))
- `ca_select` (SELECT) — USING (can_view_identity(base_of_patient(patient_id)) AND (deleted_at IS NULL))
- `ca_update` (UPDATE) — USING (is_medecin() AND can_write_identity(base_of_patient(patient_id))) · WITH CHECK (is_medecin() AND can_write_identity(base_of_patient(patient_id)))

Triggers :
- `trg_ca_inspection_guard` — BEFORE INSERT/UPDATE → `guard_inspection_status()`
- `trg_clinical_attachment_created_by` — BEFORE INSERT/UPDATE → `guard_document_created_by()`
- `trg_clinical_attachment_storage_path_scope` — BEFORE INSERT/UPDATE → `guard_storage_path_scope()`
- `trg_clinical_attachment_upload_ticket` — BEFORE INSERT/UPDATE → `guard_upload_ticket_attachment()`

### cohort · RLS activée

| Colonne | Type | Nullable | Défaut |
|---|---|---|---|
| id | uuid | non | `gen_random_uuid()` |
| base_id | uuid | non |  |
| name | text | non |  |
| filter_definition | jsonb | non | `'{}'::jsonb` |
| cohort_type | text | non | `'dynamic'::text` |
| snapshot_at | timestamp with time zone | oui |  |
| validated_only | boolean | non | `true` |
| created_by | uuid | oui |  |
| created_at | timestamp with time zone | non | `now()` |

Policies :
- `c_insert` (INSERT) — WITH CHECK can_curate(base_id)
- `c_select` (SELECT) — USING (is_medecin() AND has_base_access(base_id))
- `c_update` (UPDATE) — USING can_curate(base_id) · WITH CHECK can_curate(base_id)

Triggers :
- `trg_cohort_base_immutable` — BEFORE UPDATE → `guard_cohort_base_immutable()`

### cohort_encounter_member · RLS activée

| Colonne | Type | Nullable | Défaut |
|---|---|---|---|
| cohort_id | uuid | non |  |
| encounter_id | uuid | non |  |
| included_at | timestamp with time zone | non | `now()` |

Policies :
- `cem_delete` (DELETE) — USING can_curate(base_of_cohort(cohort_id))
- `cem_insert` (INSERT) — WITH CHECK can_curate(base_of_cohort(cohort_id))
- `cem_select` (SELECT) — USING (is_medecin() AND has_base_access(base_of_cohort(cohort_id)))

Triggers :
- `trg_cohort_encounter_membership_scope` — AFTER INSERT/UPDATE → `guard_cohort_encounter_membership()`

### cohort_member · RLS activée

| Colonne | Type | Nullable | Défaut |
|---|---|---|---|
| cohort_id | uuid | non |  |
| patient_id | uuid | non |  |
| included_at | timestamp with time zone | non | `now()` |

Policies :
- `cm_delete` (DELETE) — USING can_curate(base_of_cohort(cohort_id))
- `cm_insert` (INSERT) — WITH CHECK can_curate(base_of_cohort(cohort_id))
- `cm_select` (SELECT) — USING (is_medecin() AND has_base_access(base_of_cohort(cohort_id)))

Triggers :
- `trg_cohort_patient_membership_scope` — AFTER INSERT/UPDATE → `guard_cohort_patient_membership()`

### curation_clarification · RLS activée

| Colonne | Type | Nullable | Défaut |
|---|---|---|---|
| id | uuid | non | `gen_random_uuid()` |
| task_id | uuid | non |  |
| base_id | uuid | non |  |
| question | text | non |  |
| asked_by | uuid | oui |  |
| asked_at | timestamp with time zone | non | `now()` |
| answer | text | oui |  |
| answered_by | uuid | oui |  |
| answered_at | timestamp with time zone | oui |  |
| status | text | non | `'open'::text` |

Policies :
- `ccl_select` (SELECT) — USING (is_base_owner(base_id) OR is_assigned_curator(task_id))

Triggers :
- `trg_xbase_clarification` — BEFORE INSERT/UPDATE → `guard_xbase_clarification()`

### curation_draft · RLS activée

| Colonne | Type | Nullable | Défaut |
|---|---|---|---|
| id | uuid | non | `gen_random_uuid()` |
| task_id | uuid | non |  |
| base_id | uuid | non |  |
| patient_data | jsonb | non | `'{}'::jsonb` |
| encounters | jsonb | non | `'[]'::jsonb` |
| status | text | non | `'draft'::text` |
| created_by | uuid | oui |  |
| created_at | timestamp with time zone | non | `now()` |
| updated_at | timestamp with time zone | non | `now()` |
| superseded_at | timestamp with time zone | oui |  |
| superseded_by | uuid | oui |  |
| revision | bigint | non | `0` |

Policies :
- `cd_insert` (INSERT) — WITH CHECK (is_base_owner(base_id) OR (is_curateur() AND is_active_assigned_curator(task_id)))
- `cd_select` (SELECT) — USING (is_base_owner(base_id) OR is_assigned_curator(task_id))
- `cd_update` (UPDATE) — USING (is_base_owner(base_id) OR (is_curateur() AND is_active_assigned_curator(task_id))) · WITH CHECK (is_base_owner(base_id) OR (is_curateur() AND is_active_assigned_curator(task_id)))

Triggers :
- `trg_bump_curation_draft_revision` — BEFORE UPDATE → `bump_curation_draft_revision()`
- `trg_curation_draft_scope` — BEFORE INSERT/UPDATE → `guard_curation_draft_scope()`
- `trg_curation_draft_supersession` — BEFORE INSERT/UPDATE → `guard_curation_draft_supersession()`
- `trg_curation_draft_updated` — BEFORE UPDATE → `set_updated_at()`
- `trg_guard_finalized_draft` — BEFORE UPDATE → `guard_finalized_draft()`
- `trg_xbase_draft` — BEFORE INSERT/UPDATE → `guard_xbase_draft()`

### curation_task · RLS activée

| Colonne | Type | Nullable | Défaut |
|---|---|---|---|
| id | uuid | non | `gen_random_uuid()` |
| base_id | uuid | non |  |
| submission_id | uuid | non |  |
| assigned_to | uuid | oui |  |
| status | text | non | `'preparing'::text` |
| created_by | uuid | oui |  |
| created_at | timestamp with time zone | non | `now()` |
| updated_at | timestamp with time zone | non | `now()` |
| deleted_at | timestamp with time zone | oui |  |

Policies :
- `ct_select` (SELECT) — USING ((deleted_at IS NULL) AND is_base_active(base_id) AND (is_base_owner(base_id) OR is_assigned_curator(id)))

Triggers :
- `trg_curation_task_updated` — BEFORE UPDATE → `set_updated_at()`
- `trg_xbase_task` — BEFORE INSERT/UPDATE → `guard_xbase_task()`

### encounter · RLS activée

| Colonne | Type | Nullable | Défaut |
|---|---|---|---|
| id | uuid | non | `gen_random_uuid()` |
| patient_id | uuid | non |  |
| template_version_id | uuid | non |  |
| encounter_type | text | non |  |
| encounter_date | date | non |  |
| age_value | numeric | oui |  |
| age_unit | text | oui |  |
| data | jsonb | non | `'{}'::jsonb` |
| collection_mode | text | non | `'direct'::text` |
| validation_status | text | non | `'draft'::text` |
| created_by | uuid | oui |  |
| created_at | timestamp with time zone | non | `now()` |
| updated_at | timestamp with time zone | non | `now()` |
| deleted_at | timestamp with time zone | oui |  |
| deleted_by | uuid | oui |  |
| deletion_reason | text | oui |  |

Policies :
- `e_select` (SELECT) — USING (has_base_access(base_of_patient(patient_id)) AND (deleted_at IS NULL))

Triggers :
- `trg_encounter_cross_sectional_rejected` — BEFORE INSERT → `reject_cross_sectional_encounter()`
- `trg_encounter_curated_complete` — BEFORE INSERT/UPDATE → `assert_curated_complete()`
- `trg_encounter_no_downgrade` — BEFORE UPDATE → `guard_no_curated_downgrade()`
- `trg_encounter_recompute_age` — BEFORE UPDATE → `recompute_encounter_age()`
- `trg_encounter_structural_immutable` — BEFORE UPDATE → `guard_structural_immutable()`
- `trg_encounter_updated` — BEFORE UPDATE → `set_updated_at()`
- `trg_refresh_patient_inclusion_date` — AFTER INSERT/UPDATE → `trg_refresh_patient_inclusion_date()`

### export_log · RLS activée

| Colonne | Type | Nullable | Défaut |
|---|---|---|---|
| id | uuid | non | `gen_random_uuid()` |
| cohort_id | uuid | oui |  |
| exported_by | uuid | oui |  |
| exported_at | timestamp with time zone | non | `now()` |
| format | text | non |  |
| export_options | jsonb | non | `'{}'::jsonb` |
| patient_count | integer | oui |  |
| encounter_count | integer | oui |  |
| stored_file_path | text | oui |  |
| file_hash | text | oui |  |
| template_versions | jsonb | oui |  |
| generation_mode | text | non | `'client'::text` |
| generated_by_function | text | oui |  |
| server_generated_at | timestamp with time zone | oui |  |
| base_id | uuid | non |  |
| cohort_name | text | non |  |

Policies :
- `el_insert` (INSERT) — WITH CHECK false
- `el_select` (SELECT) — USING can_export_data(base_id)

Triggers :
- `trg_audit_export` — AFTER INSERT → `trg_audit_export_fn()`
- `trg_export_generation_mode` — BEFORE INSERT/UPDATE → `guard_export_generation_mode()`
- `trg_export_log_upload_ticket` — BEFORE INSERT/UPDATE → `guard_upload_ticket_attachment()`

### field_change_log · RLS activée

| Colonne | Type | Nullable | Défaut |
|---|---|---|---|
| id | uuid | non | `gen_random_uuid()` |
| base_id | uuid | oui |  |
| entity | text | non |  |
| entity_id | uuid | non |  |
| field_key | text | non |  |
| old_value | jsonb | oui |  |
| new_value | jsonb | oui |  |
| changed_by | uuid | oui |  |
| reason | text | oui |  |
| source | text | non | `'direct_entry'::text` |
| changed_at | timestamp with time zone | non | `now()` |

Policies :
- `fcl_select` (SELECT) — USING (is_medecin() AND has_base_access(base_id))

### import_batch · RLS activée

| Colonne | Type | Nullable | Défaut |
|---|---|---|---|
| id | uuid | non | `gen_random_uuid()` |
| base_id | uuid | non |  |
| file_hash | text | oui |  |
| template_version_id | uuid | oui |  |
| row_count | integer | non | `0` |
| patients_new | integer | non | `0` |
| patients_updated | integer | non | `0` |
| encounters | integer | non | `0` |
| conflict_mode | text | oui |  |
| imported_by | uuid | oui |  |
| created_at | timestamp with time zone | non | `now()` |
| status | text | non | `'completed'::text` |
| updated_at | timestamp with time zone | non | `now()` |
| completed_at | timestamp with time zone | oui |  |
| target_validation_status | text | oui |  |
| expected_rows | integer | oui |  |
| error_count | integer | non | `0` |
| resume_state | text | non | `'modern'::text` |
| replaces_batch_id | uuid | oui |  |
| replacement_report | jsonb | oui |  |

Policies :
- `ib_select` (SELECT) — USING (is_medecin() AND has_base_access(base_id))

### import_batch_row · RLS activée

| Colonne | Type | Nullable | Défaut |
|---|---|---|---|
| batch_id | uuid | non |  |
| source_row_number | integer | non |  |
| normalized_row_hash | text | non |  |
| outcome | text | non |  |
| result | jsonb | non | `'{}'::jsonb` |
| created_at | timestamp with time zone | non | `now()` |
| updated_at | timestamp with time zone | non | `now()` |

Policies : *(aucune — table fermée aux clients, écrite par RPC/serveur seulement)*

### import_row_hash · RLS activée

| Colonne | Type | Nullable | Défaut |
|---|---|---|---|
| batch_id | uuid | non |  |
| row_hash | text | non |  |
| base_id | uuid | non |  |
| hash_kind | text | non | `'clinical'::text` |
| source_file_hash | text | oui |  |
| source_row_number | integer | oui |  |
| normalized_row_hash | text | oui |  |

Policies : *(aucune — table fermée aux clients, écrite par RPC/serveur seulement)*

### mission_account_credential · RLS activée

| Colonne | Type | Nullable | Défaut |
|---|---|---|---|
| user_id | uuid | non |  |
| base_id | uuid | non |  |
| owner_user_id | uuid | non |  |
| account_label | text | non |  |
| login_identifier | text | non |  |
| password_ciphertext | text | non |  |
| password_nonce | text | non |  |
| credential_generation | integer | non | `1` |
| status | text | non | `'provisioning'::text` |
| created_at | timestamp with time zone | non | `now()` |
| updated_at | timestamp with time zone | non | `now()` |
| last_rotated_at | timestamp with time zone | non | `now()` |

Policies : *(aucune — table fermée aux clients, écrite par RPC/serveur seulement)*

### mission_credential_operation · RLS activée

| Colonne | Type | Nullable | Défaut |
|---|---|---|---|
| operation_id | uuid | non |  |
| actor_id | uuid | non |  |
| action | text | non |  |
| base_id | uuid | non |  |
| user_id | uuid | non |  |
| request_fingerprint | text | non |  |
| result_generation | integer | non |  |
| status | text | non | `'pending'::text` |
| created_at | timestamp with time zone | non | `now()` |
| completed_at | timestamp with time zone | oui |  |

Policies : *(aucune — table fermée aux clients, écrite par RPC/serveur seulement)*

### offline_encounter_operation · RLS activée

| Colonne | Type | Nullable | Défaut |
|---|---|---|---|
| user_id | uuid | non |  |
| operation_id | text | non |  |
| encounter_id | uuid | non |  |
| request_fingerprint | text | non |  |
| result_updated_at | timestamp with time zone | oui |  |
| created_at | timestamp with time zone | non | `now()` |
| completed_at | timestamp with time zone | oui |  |

Policies : *(aucune — table fermée aux clients, écrite par RPC/serveur seulement)*

### patient · RLS activée

| Colonne | Type | Nullable | Défaut |
|---|---|---|---|
| id | uuid | non | `gen_random_uuid()` |
| base_id | uuid | non |  |
| patient_code | text | non |  |
| template_version_id | uuid | non |  |
| data | jsonb | non | `'{}'::jsonb` |
| collection_mode | text | non | `'direct'::text` |
| validation_status | text | non | `'draft'::text` |
| created_by | uuid | oui |  |
| created_at | timestamp with time zone | non | `now()` |
| updated_at | timestamp with time zone | non | `now()` |
| deleted_at | timestamp with time zone | oui |  |
| deleted_by | uuid | oui |  |
| deletion_reason | text | oui |  |
| inclusion_date | date | oui | `CURRENT_DATE` |
| row_version | bigint | non | `1` |

Policies :
- `p_select` (SELECT) — USING (has_base_access(base_id) AND (deleted_at IS NULL))

Triggers :
- `trg_patient_curated_complete` — BEFORE INSERT/UPDATE → `assert_curated_complete()`
- `trg_patient_no_downgrade` — BEFORE UPDATE → `guard_no_curated_downgrade()`
- `trg_patient_row_version` — BEFORE UPDATE → `bump_patient_row_version()`
- `trg_patient_structural_immutable` — BEFORE UPDATE → `guard_structural_immutable()`
- `trg_patient_updated` — BEFORE UPDATE → `set_updated_at()`

### patient_curation_idempotency · RLS activée

| Colonne | Type | Nullable | Défaut |
|---|---|---|---|
| user_id | uuid | non |  |
| idempotency_key | text | non |  |
| request_fingerprint | text | non |  |
| patient_id | uuid | non |  |
| submission_id | uuid | non |  |
| task_id | uuid | non |  |
| created_at | timestamp with time zone | non | `now()` |

Policies : *(aucune — table fermée aux clients, écrite par RPC/serveur seulement)*

### patient_identity · RLS activée

| Colonne | Type | Nullable | Défaut |
|---|---|---|---|
| id | uuid | non | `gen_random_uuid()` |
| base_id | uuid | non |  |
| patient_code | text | non |  |
| full_name | text | oui |  |
| date_of_birth | date | oui |  |
| phone | text | oui |  |
| address | text | oui |  |
| external_identifier | text | oui |  |
| created_by | uuid | oui |  |
| created_at | timestamp with time zone | non | `now()` |
| deleted_at | timestamp with time zone | oui |  |
| deleted_by | uuid | oui |  |
| deletion_reason | text | oui |  |

Policies : *(aucune — table fermée aux clients, écrite par RPC/serveur seulement)*

Triggers :
- `trg_identity_structural_immutable` — BEFORE UPDATE → `guard_structural_immutable()`

### profiles · RLS activée

| Colonne | Type | Nullable | Défaut |
|---|---|---|---|
| id | uuid | non |  |
| full_name | text | non | `''::text` |
| global_role | text | non | `'medecin'::text` |
| language | text | non | `'fr'::text` |
| created_at | timestamp with time zone | non | `now()` |

Policies :
- `profiles_select_admin` (SELECT) — USING is_system_admin()
- `profiles_select_collaborators` (SELECT) — USING owns_base_with_member(id)
- `profiles_select_self` (SELECT) — USING ((id = auth.uid()) AND is_authenticated_session_current())
- `profiles_update_admin` (UPDATE) — USING (is_system_admin() AND (id <> auth.uid())) · WITH CHECK (is_system_admin() AND (id <> auth.uid()))
- `profiles_update_self` (UPDATE) — USING ((id = auth.uid()) AND is_authenticated_session_current()) · WITH CHECK ((id = auth.uid()) AND is_authenticated_session_current())

Triggers :
- `trg_guard_profile_role` — BEFORE UPDATE → `guard_profile_role()`

### quarantine_move_log · RLS activée

| Colonne | Type | Nullable | Défaut |
|---|---|---|---|
| id | uuid | non | `gen_random_uuid()` |
| entity | text | non |  |
| entity_id | uuid | non |  |
| base_id | uuid | non |  |
| run_id | uuid | non |  |
| inspected_by | uuid | oui |  |
| source_bucket | text | non |  |
| source_path | text | non |  |
| quarantine_bucket | text | non | `'quarantined-uploads'::text` |
| quarantine_path | text | non |  |
| status | text | non | `'started'::text` |
| engine | text | non |  |
| signature | text | oui |  |
| file_hash | text | non |  |
| file_size | bigint | non |  |
| detected_mime_type | text | oui |  |
| mime_type | text | oui |  |
| extra | jsonb | non | `'{}'::jsonb` |
| last_error | text | oui |  |
| created_at | timestamp with time zone | non | `now()` |
| updated_at | timestamp with time zone | non | `now()` |
| finalized_at | timestamp with time zone | oui |  |

Policies : *(aucune — table fermée aux clients, écrite par RPC/serveur seulement)*

### raw_document · RLS activée

| Colonne | Type | Nullable | Défaut |
|---|---|---|---|
| id | uuid | non | `gen_random_uuid()` |
| submission_id | uuid | non |  |
| base_id | uuid | non |  |
| label | text | oui |  |
| storage_path | text | non |  |
| mime_type | text | non |  |
| detected_mime_type | text | oui |  |
| file_size | bigint | oui |  |
| file_hash | text | oui |  |
| inspection_status | text | non | `'accepted_client'::text` |
| inspected_at | timestamp with time zone | oui |  |
| created_by | uuid | oui |  |
| created_at | timestamp with time zone | non | `now()` |
| deleted_at | timestamp with time zone | oui |  |
| deletion_reason | text | oui |  |
| inspection_run_id | uuid | oui |  |
| inspection_started_at | timestamp with time zone | oui |  |
| inspection_attempt_count | integer | non | `0` |
| last_inspection_attempt_at | timestamp with time zone | oui |  |
| last_inspection_error | text | oui |  |
| quarantine_bucket | text | oui |  |
| quarantine_path | text | oui |  |
| quarantined_at | timestamp with time zone | oui |  |
| upload_ticket_id | uuid | oui |  |

Policies :
- `rd_insert` (INSERT) — WITH CHECK is_base_owner(base_id)
- `rd_select` (SELECT) — USING (is_base_active(base_id) AND (is_base_owner(base_id) OR is_assigned_to_submission(submission_id)) AND (deleted_at IS NULL))
- `rd_update` (UPDATE) — USING ((deleted_at IS NULL) AND is_base_owner(base_id)) · WITH CHECK ((deleted_at IS NULL) AND is_base_owner(base_id))

Triggers :
- `trg_raw_document_created_by` — BEFORE INSERT/UPDATE → `guard_document_created_by()`
- `trg_raw_document_storage_path_scope` — BEFORE INSERT/UPDATE → `guard_storage_path_scope()`
- `trg_raw_document_upload_ticket` — BEFORE INSERT/UPDATE → `guard_upload_ticket_attachment()`
- `trg_rd_inspection_guard` — BEFORE INSERT/UPDATE → `guard_inspection_status()`
- `trg_xbase_document` — BEFORE INSERT/UPDATE → `guard_xbase_document()`

### raw_submission · RLS activée

| Colonne | Type | Nullable | Défaut |
|---|---|---|---|
| id | uuid | non | `gen_random_uuid()` |
| base_id | uuid | non |  |
| target_patient_id | uuid | non |  |
| template_version_id | uuid | oui |  |
| scope | text | non | `'patient'::text` |
| case_code | text | non |  |
| external_ref | text | oui |  |
| collection_mode | text | non | `'assisted'::text` |
| status | text | non | `'received'::text` |
| notes | text | oui |  |
| submitted_by | uuid | oui |  |
| created_at | timestamp with time zone | non | `now()` |
| deleted_at | timestamp with time zone | oui |  |
| deleted_by | uuid | oui |  |
| deletion_reason | text | oui |  |

Policies :
- `rs_select` (SELECT) — USING ((deleted_at IS NULL) AND is_base_active(base_id) AND (is_base_owner(base_id) OR is_assigned_to_submission(id)))

Triggers :
- `trg_raw_submission_cross_sectional_rejected` — BEFORE INSERT/UPDATE → `reject_cross_sectional_encounter_submission()`
- `trg_xbase_submission` — BEFORE INSERT/UPDATE → `guard_xbase_submission()`

### release_component_state · RLS activée

| Colonne | Type | Nullable | Défaut |
|---|---|---|---|
| component | text | non |  |
| sha256 | text | non |  |
| applied_at | timestamp with time zone | non | `now()` |
| applied_by | name | non | `CURRENT_USER` |

Policies :
- `release_component_state_no_client_access` (ALL) — USING false · WITH CHECK false

### research_group · RLS activée

| Colonne | Type | Nullable | Défaut |
|---|---|---|---|
| id | uuid | non | `gen_random_uuid()` |
| name | text | non |  |
| owner_user_id | uuid | non |  |
| created_at | timestamp with time zone | non | `now()` |

Policies :
- `rg_delete` (DELETE) — USING (owner_user_id = auth.uid())
- `rg_insert` (INSERT) — WITH CHECK ((owner_user_id = auth.uid()) AND is_medecin())
- `rg_select` (SELECT) — USING (owner_user_id = auth.uid())
- `rg_update` (UPDATE) — USING (owner_user_id = auth.uid()) · WITH CHECK (owner_user_id = auth.uid())

### research_group_base · RLS activée

| Colonne | Type | Nullable | Défaut |
|---|---|---|---|
| base_id | uuid | non |  |
| group_id | uuid | non |  |
| added_at | timestamp with time zone | non | `now()` |

Policies :
- `rgb_delete` (DELETE) — USING (EXISTS ( SELECT 1
   FROM research_group g
  WHERE ((g.id = research_group_base.group_id) AND (g.owner_user_id = auth.uid()))))
- `rgb_insert` (INSERT) — WITH CHECK ((EXISTS ( SELECT 1
   FROM research_group g
  WHERE ((g.id = research_group_base.group_id) AND (g.owner_user_id = auth.uid())))) AND is_base_owner(base_id))
- `rgb_select` (SELECT) — USING (EXISTS ( SELECT 1
   FROM research_group g
  WHERE ((g.id = research_group_base.group_id) AND (g.owner_user_id = auth.uid()))))

### template · RLS activée

| Colonne | Type | Nullable | Défaut |
|---|---|---|---|
| id | uuid | non | `gen_random_uuid()` |
| name | text | non |  |
| specialty | text | oui |  |
| owner_user_id | uuid | oui |  |
| is_global | boolean | non | `false` |
| created_at | timestamp with time zone | non | `now()` |

Policies :
- `template_insert` (INSERT) — WITH CHECK (is_system_admin() OR (is_medecin() AND (owner_user_id = auth.uid()) AND (is_global = false)))
- `template_read` (SELECT) — USING (is_global OR (owner_user_id = auth.uid()) OR is_system_admin())
- `template_update` (UPDATE) — USING owns_template(id) · WITH CHECK (is_system_admin() OR ((owner_user_id = auth.uid()) AND (is_global = false)))

### template_field · RLS activée

| Colonne | Type | Nullable | Défaut |
|---|---|---|---|
| id | uuid | non | `gen_random_uuid()` |
| template_version_id | uuid | non |  |
| field_key | text | non |  |
| label | text | non |  |
| scope | text | non |  |
| section | text | non |  |
| type | text | non |  |
| unit | text | oui |  |
| allowed_values | jsonb | oui |  |
| required | boolean | non | `false` |
| min_value | numeric | oui |  |
| max_value | numeric | oui |  |
| allow_missing_codes | boolean | non | `true` |
| display_order | integer | non | `0` |
| encounter_types | ARRAY | oui |  |
| description | text | oui |  |
| default_value | text | oui |  |
| missing_reasons | ARRAY | non | `ARRAY['non_fait'::text, 'inconnu'::text, 'non_applicable'::text]` |
| allowed_options | jsonb | oui |  |
| section_id | uuid | oui |  |
| is_multiple | boolean | non | `false` |

Policies :
- `tf_read` (SELECT) — USING can_read_template(template_of_version(template_version_id))
- `tf_write` (ALL) — USING owns_template(template_of_version(template_version_id)) · WITH CHECK owns_template(template_of_version(template_version_id))

Triggers :
- `trg_template_field_allowed_options` — BEFORE INSERT/UPDATE → `enforce_template_field_allowed_options()`
- `trg_template_field_default_value` — BEFORE INSERT/UPDATE → `enforce_template_field_default_value()`
- `trg_template_field_missing_reasons` — BEFORE INSERT/UPDATE → `enforce_template_field_missing_reasons()`
- `trg_template_field_observation_model` — BEFORE INSERT/UPDATE → `enforce_observation_model_on_template_field()`
- `trg_template_field_section` — BEFORE INSERT/UPDATE → `sync_template_field_section()`
- `trg_tf_delete` — BEFORE DELETE → `guard_template_field_delete()`
- `trg_tf_locked_insert` — BEFORE INSERT → `guard_template_field_locked_insert()`
- `trg_tf_update` — BEFORE UPDATE → `guard_template_field_update()`

### template_operation · RLS activée

| Colonne | Type | Nullable | Défaut |
|---|---|---|---|
| owner_user_id | uuid | non |  |
| operation_key | uuid | non |  |
| payload_hash | text | non |  |
| result | jsonb | non |  |
| created_at | timestamp with time zone | non | `now()` |

Policies : *(aucune — table fermée aux clients, écrite par RPC/serveur seulement)*

### template_section · RLS activée

| Colonne | Type | Nullable | Défaut |
|---|---|---|---|
| id | uuid | non | `gen_random_uuid()` |
| template_version_id | uuid | non |  |
| section_key | text | non |  |
| label | text | non |  |
| display_order | integer | non | `0` |
| created_at | timestamp with time zone | non | `now()` |

Policies :
- `ts_read` (SELECT) — USING can_read_template(template_of_version(template_version_id))
- `ts_write` (ALL) — USING owns_template(template_of_version(template_version_id)) · WITH CHECK owns_template(template_of_version(template_version_id))

Triggers :
- `trg_template_section_write` — BEFORE INSERT/UPDATE/DELETE → `guard_template_section_write()`

### template_version · RLS activée

| Colonne | Type | Nullable | Défaut |
|---|---|---|---|
| id | uuid | non | `gen_random_uuid()` |
| template_id | uuid | non |  |
| version_number | integer | non |  |
| status | text | non | `'draft'::text` |
| created_by | uuid | oui |  |
| created_at | timestamp with time zone | non | `now()` |
| published_at | timestamp with time zone | oui |  |

Policies :
- `tv_delete` (DELETE) — USING (owns_template(template_id) AND (status = 'draft'::text))
- `tv_insert` (INSERT) — WITH CHECK (owns_template(template_id) AND (status = 'draft'::text))
- `tv_read` (SELECT) — USING can_read_template(template_id)
- `tv_update` (UPDATE) — USING owns_template(template_id) · WITH CHECK owns_template(template_id)

Triggers :
- `trg_audit_template_publish` — AFTER UPDATE → `trg_audit_template_publish_fn()`
- `trg_template_version_state` — BEFORE INSERT/UPDATE → `guard_template_version_state()`

### template_version_status_authorization · RLS activée

| Colonne | Type | Nullable | Défaut |
|---|---|---|---|
| txid | bigint | non |  |
| version_id | uuid | non |  |
| from_status | text | non |  |
| to_status | text | non |  |
| used_at | timestamp with time zone | oui |  |
| created_at | timestamp with time zone | non | `now()` |

Policies : *(aucune — table fermée aux clients, écrite par RPC/serveur seulement)*

### terminology_concept · RLS activée

| Colonne | Type | Nullable | Défaut |
|---|---|---|---|
| id | uuid | non | `gen_random_uuid()` |
| release_id | uuid | non |  |
| code | text | oui |  |
| label | text | non |  |
| kind | text | non |  |
| depth | integer | non | `0` |
| parent_id | uuid | oui |  |
| is_selectable | boolean | non | `true` |
| search_text | text | oui |  |
| created_at | timestamp with time zone | non | `now()` |

Policies :
- `terminology_concept_read` (SELECT) — USING true

### terminology_release · RLS activée

| Colonne | Type | Nullable | Défaut |
|---|---|---|---|
| id | uuid | non | `gen_random_uuid()` |
| slug | text | non |  |
| title | text | non |  |
| source | text | non |  |
| version | text | non |  |
| license | text | oui |  |
| attribution | text | oui |  |
| concept_count | integer | non | `0` |
| is_active | boolean | non | `false` |
| imported_at | timestamp with time zone | oui |  |
| created_at | timestamp with time zone | non | `now()` |

Policies :
- `terminology_release_read` (SELECT) — USING true

### upload_ticket · RLS activée

| Colonne | Type | Nullable | Défaut |
|---|---|---|---|
| id | uuid | non | `gen_random_uuid()` |
| owner_user_id | uuid | non |  |
| base_id | uuid | non |  |
| bucket | text | non |  |
| path | text | non |  |
| status | text | non | `'pending'::text` |
| created_at | timestamp with time zone | non | `now()` |
| expires_at | timestamp with time zone | non | `(now() + '00:30:00'::interval)` |
| attached_at | timestamp with time zone | oui |  |
| cleaned_at | timestamp with time zone | oui |  |
| last_error | text | oui |  |
| idempotency_key | uuid | oui |  |
| file_hash | text | oui |  |
| file_size | bigint | oui |  |
| mime_type | text | oui |  |

Policies :
- `upload_ticket_select_own` (SELECT) — USING (owner_user_id = auth.uid())

### validation_rule · RLS activée

| Colonne | Type | Nullable | Défaut |
|---|---|---|---|
| id | uuid | non | `gen_random_uuid()` |
| template_version_id | uuid | non |  |
| rule | jsonb | non |  |
| message | text | oui |  |
| severity | text | non | `'block'::text` |

Policies :
- `vr_read` (SELECT) — USING can_read_template(template_of_version(template_version_id))
- `vr_write` (ALL) — USING owns_template(template_of_version(template_version_id)) · WITH CHECK owns_template(template_of_version(template_version_id))

Triggers :
- `trg_vr_inuse` — BEFORE INSERT/UPDATE/DELETE → `guard_validation_rule_inuse()`
- `trg_vr_locked` — BEFORE INSERT/UPDATE/DELETE → `guard_validation_rule_locked()`
- `trg_vr_structure` — BEFORE INSERT/UPDATE → `guard_validation_rule_structure()`

## Fonctions (public)

| Fonction | Arguments | Sécurité | Langage |
|---|---|---|---|
| accept_invitation | p_token text | DEFINER | plpgsql |
| activity_public_metadata | p_action text, p_metadata jsonb, p_is_owner boolean | DEFINER | sql |
| answer_clarification | p_clarification_id uuid, p_answer text | DEFINER | plpgsql |
| archive_template_version | p_version_id uuid | DEFINER | plpgsql |
| armor | bytea | INVOKER | c |
| armor | bytea, text[], text[] | INVOKER | c |
| assert_access_change_allowed | p_base_id uuid, p_target_user_id uuid, p_new_can_view_identity boolean, p_new_can_view_raw_documents boolean, p_new_can_edit_structured_data boolean, p_new_can_export_data boolean, p_new_can_manage_access boolean, p_old_can_view_identity boolean, p_old_can_view_raw_documents boolean, p_old_can_edit_structured_data boolean, p_old_can_export_data boolean, p_old_can_manage_access boolean | DEFINER | plpgsql |
| assert_curated_complete | — | INVOKER | plpgsql |
| assert_data_valid | p_version uuid, p_scope text, p_data jsonb | INVOKER | plpgsql |
| assert_export_columns_safe | p_template_version_id uuid, p_columns text[] | INVOKER | plpgsql |
| assert_no_hidden_values | p_version uuid, p_scope text, p_data jsonb | INVOKER | plpgsql |
| assert_no_unknown_fields | p_version uuid, p_scope text, p_data jsonb | INVOKER | plpgsql |
| assert_required_complete | p_version uuid, p_scope text, p_data jsonb, p_encounter_type text | INVOKER | plpgsql |
| assert_rule_structure | p_version_id uuid, p_rule jsonb | INVOKER | plpgsql |
| assert_upload_path_scope | p_base_id uuid, p_bucket text, p_path text | DEFINER | plpgsql |
| assert_validation_rules | p_version uuid, p_data jsonb | INVOKER | plpgsql |
| assert_visibility_acyclic | p_version_id uuid, p_rule jsonb, p_rule_id uuid | INVOKER | plpgsql |
| base_activity_log | p_base_id uuid, p_before timestamp with time zone, p_limit integer, p_action_filter text, p_before_id uuid | DEFINER | plpgsql |
| base_completeness_stats | p_base_id uuid, p_mode text | INVOKER | sql |
| base_completion_queue | p_base_id uuid, p_limit integer | INVOKER | sql |
| base_completion_queue_page | p_base_id uuid, p_limit integer, p_offset integer | INVOKER | sql |
| base_identity_audit | p_base_id uuid | DEFINER | plpgsql |
| base_inclusion_stats | p_base_id uuid | INVOKER | sql |
| base_of_cohort | p_cohort uuid | DEFINER | sql |
| base_of_patient | p_patient uuid | DEFINER | sql |
| base_proposals | p_base_id uuid, p_limit integer, p_offset integer | INVOKER | plpgsql |
| begin_import_batch | p_base_id uuid, p_file_hash text, p_template_version_id uuid, p_conflict text, p_status text, p_expected_rows integer | DEFINER | plpgsql |
| begin_mission_account_creation | p_operation_id uuid, p_actor_id uuid, p_base_id uuid, p_user_id uuid, p_account_label text, p_login_identifier text, p_password_ciphertext text, p_password_nonce text, p_request_fingerprint text | DEFINER | plpgsql |
| begin_mission_credential_regeneration | p_operation_id uuid, p_actor_id uuid, p_access_id uuid, p_password_ciphertext text, p_password_nonce text, p_request_fingerprint text | DEFINER | plpgsql |
| bump_curation_draft_revision | — | INVOKER | plpgsql |
| bump_patient_row_version | — | INVOKER | plpgsql |
| can_create_structured_data | p_base uuid | DEFINER | sql |
| can_curate | p_base uuid | DEFINER | sql |
| can_edit_structured_data | p_base uuid | DEFINER | sql |
| can_export_data | p_base uuid | DEFINER | sql |
| can_manage_access | p_base uuid | DEFINER | sql |
| can_read_template | p_template uuid | DEFINER | sql |
| can_view_identity | p_base uuid | DEFINER | sql |
| can_view_raw_documents | p_base uuid | DEFINER | sql |
| can_write_identity | p_base uuid | DEFINER | sql |
| cancel_import_batch | p_batch_id uuid | DEFINER | plpgsql |
| claim_curation_task | p_task_id uuid | DEFINER | plpgsql |
| cohort_preview | p_base_id uuid, p_filter jsonb, p_validated_only boolean | INVOKER | sql |
| complete_file_inspection | p_entity text, p_id uuid, p_run_id uuid, p_user_id uuid, p_status text, p_inspected_at timestamp with time zone, p_file_hash text, p_file_size bigint, p_detected_mime_type text, p_mime_type text, p_engine text, p_signature text, p_extra jsonb, p_quarantine_bucket text, p_quarantine_path text | DEFINER | plpgsql |
| complete_import_batch | p_batch_id uuid | DEFINER | plpgsql |
| complete_mission_credential_operation | p_operation_id uuid, p_actor_id uuid | DEFINER | plpgsql |
| complete_verified_upload_operation | p_ticket_id uuid, p_user_id uuid, p_entity text, p_metadata jsonb, p_verified_file_hash text, p_verified_file_size bigint, p_verified_mime_type text | DEFINER | plpgsql |
| compute_age | p_dob date, p_at date, p_unit text | INVOKER | sql |
| copy_template_fields | p_source_version_id uuid, p_target_version_id uuid, p_force_patient_scope boolean | INVOKER | sql |
| create_base_from_model | p_name text, p_specialty text, p_source_version_id uuid | DEFINER | plpgsql |
| create_base_from_model_observation | p_name text, p_specialty text, p_source_version_id uuid, p_observation_model text | DEFINER | plpgsql |
| create_base_invitation | p_base_id uuid, p_invited_email text, p_access_role text, p_can_view_identity boolean, p_can_view_raw_documents boolean, p_can_edit_structured_data boolean, p_can_export_data boolean, p_can_manage_access boolean, p_token_hash text, p_expires_at timestamp with time zone | DEFINER | plpgsql |
| create_cohort_snapshot | p_base_id uuid, p_name text, p_filter jsonb, p_validated_only boolean | INVOKER | plpgsql |
| create_curation_submission | p_base_id uuid, p_target_patient_id uuid, p_external_ref text, p_scope text | DEFINER | plpgsql |
| create_encounter | p_patient_id uuid, p_encounter_type text, p_encounter_date date, p_validation_status text, p_data jsonb, p_age_unit text | DEFINER | plpgsql |
| create_next_personal_template_version | p_template_id uuid | DEFINER | plpgsql |
| create_patient | p_base_id uuid, p_patient_code text, p_full_name text, p_date_of_birth date, p_phone text, p_address text, p_external_identifier text, p_permanent_data jsonb | DEFINER | plpgsql |
| create_patient_curation_submission | p_base_id uuid, p_patient_code text, p_full_name text, p_date_of_birth date, p_phone text, p_address text, p_external_identifier text, p_idempotency_key text | DEFINER | plpgsql |
| create_template_bundle | p_payload jsonb, p_operation_key uuid | DEFINER | plpgsql |
| create_upload_operation | p_base_id uuid, p_bucket text, p_path text, p_idempotency_key uuid, p_file_hash text, p_file_size bigint, p_mime_type text, p_ttl_seconds integer | DEFINER | plpgsql |
| create_upload_ticket | p_base_id uuid, p_bucket text, p_path text, p_ttl_seconds integer | DEFINER | plpgsql |
| crypt | text, text | INVOKER | c |
| curation_pool | — | DEFINER | sql |
| dearmor | text | INVOKER | c |
| decrypt | bytea, bytea, text | INVOKER | c |
| decrypt_iv | bytea, bytea, bytea, text | INVOKER | c |
| delete_cohort | p_cohort_id uuid | DEFINER | plpgsql |
| delete_curation_request | p_task_id uuid, p_reason text, p_delete_patient boolean | DEFINER | plpgsql |
| delete_template | p_template_id uuid | DEFINER | plpgsql |
| delete_template_field | p_field_id uuid | DEFINER | plpgsql |
| detect_import_duplicates | p_base_id uuid, p_rows jsonb | DEFINER | plpgsql |
| digest | bytea, text | INVOKER | c |
| digest | text, text | INVOKER | c |
| download_base_snapshot | p_base_id uuid | INVOKER | sql |
| duplicate_template_version | p_source_version_id uuid | DEFINER | plpgsql |
| encrypt | bytea, bytea, text | INVOKER | c |
| encrypt_iv | bytea, bytea, bytea, text | INVOKER | c |
| enforce_observation_model_on_base | — | DEFINER | plpgsql |
| enforce_observation_model_on_template_field | — | DEFINER | plpgsql |
| enforce_template_field_allowed_options | — | DEFINER | plpgsql |
| enforce_template_field_default_value | — | INVOKER | plpgsql |
| enforce_template_field_missing_reasons | — | DEFINER | plpgsql |
| ensure_curation_draft | p_task_id uuid, p_base_id uuid | INVOKER | plpgsql |
| extend_mission_access | p_access_id uuid, p_expires_at timestamp with time zone | DEFINER | plpgsql |
| finalize_curation_task | p_task_id uuid | DEFINER | plpgsql |
| finalize_patient | p_patient_id uuid | DEFINER | plpgsql |
| finalize_upload_operation | p_ticket_id uuid, p_entity text, p_metadata jsonb | DEFINER | plpgsql |
| find_identity_matches | p_base_id uuid, p_full_name text, p_date_of_birth date | DEFINER | plpgsql |
| fips_mode | — | INVOKER | c |
| gen_random_bytes | integer | INVOKER | c |
| gen_random_uuid | — | INVOKER | c |
| gen_salt | text | INVOKER | c |
| gen_salt | text, integer | INVOKER | c |
| get_import_batch_state | p_batch_id uuid | DEFINER | plpgsql |
| get_patient_identity | p_patient_id uuid | DEFINER | plpgsql |
| guard_access_escalation | — | INVOKER | plpgsql |
| guard_base_access_medecin | — | DEFINER | plpgsql |
| guard_base_inclusion_target_revision | — | INVOKER | plpgsql |
| guard_base_owner_immutable | — | INVOKER | plpgsql |
| guard_base_template_version | — | DEFINER | plpgsql |
| guard_cohort_base_immutable | — | DEFINER | plpgsql |
| guard_cohort_encounter_membership | — | DEFINER | plpgsql |
| guard_cohort_patient_membership | — | DEFINER | plpgsql |
| guard_curation_draft_scope | — | DEFINER | plpgsql |
| guard_curation_draft_supersession | — | DEFINER | plpgsql |
| guard_document_created_by | — | DEFINER | plpgsql |
| guard_export_generation_mode | — | DEFINER | plpgsql |
| guard_finalized_draft | — | INVOKER | plpgsql |
| guard_inspection_status | — | INVOKER | plpgsql |
| guard_no_curated_downgrade | — | INVOKER | plpgsql |
| guard_profile_role | — | DEFINER | plpgsql |
| guard_storage_path_scope | — | DEFINER | plpgsql |
| guard_structural_immutable | — | INVOKER | plpgsql |
| guard_template_field_delete | — | DEFINER | plpgsql |
| guard_template_field_locked_insert | — | DEFINER | plpgsql |
| guard_template_field_update | — | DEFINER | plpgsql |
| guard_template_section_write | — | DEFINER | plpgsql |
| guard_template_version_state | — | DEFINER | plpgsql |
| guard_upload_ticket_attachment | — | DEFINER | plpgsql |
| guard_validation_rule_inuse | — | INVOKER | plpgsql |
| guard_validation_rule_locked | — | DEFINER | plpgsql |
| guard_validation_rule_structure | — | INVOKER | plpgsql |
| guard_xbase_clarification | — | DEFINER | plpgsql |
| guard_xbase_document | — | DEFINER | plpgsql |
| guard_xbase_draft | — | DEFINER | plpgsql |
| guard_xbase_submission | — | DEFINER | plpgsql |
| guard_xbase_task | — | DEFINER | plpgsql |
| handle_new_user | — | DEFINER | plpgsql |
| has_base_access | p_base uuid | DEFINER | sql |
| has_pending_upload_ticket | p_bucket text, p_path text | DEFINER | sql |
| hmac | bytea, bytea, text | INVOKER | c |
| hmac | text, text, text | INVOKER | c |
| import_records | p_base_id uuid, p_rows jsonb, p_dry_run boolean, p_status text, p_conflict text, p_file_hash text, p_template_version_id uuid, p_batch_id uuid | DEFINER | plpgsql |
| import_records_legacy | p_base_id uuid, p_rows jsonb, p_dry_run boolean, p_status text, p_conflict text, p_file_hash text, p_template_version_id uuid, p_batch_id uuid | DEFINER | plpgsql |
| import_records_with_receipts | p_base_id uuid, p_rows jsonb, p_dry_run boolean, p_status text, p_conflict text, p_file_hash text, p_template_version_id uuid, p_batch_id uuid | DEFINER | plpgsql |
| invitation_permissions_still_valid | p_base_id uuid, p_actor uuid, p_can_view_identity boolean, p_can_view_raw_documents boolean, p_can_edit_structured_data boolean, p_can_export_data boolean, p_can_manage_access boolean | DEFINER | sql |
| is_active_assigned_curator | p_task_id uuid | DEFINER | sql |
| is_assigned_curator | p_task_id uuid | DEFINER | sql |
| is_assigned_to_submission | p_submission_id uuid | DEFINER | sql |
| is_authenticated_session_current | — | DEFINER | sql |
| is_base_active | p_base uuid | DEFINER | sql |
| is_base_owner | p_base uuid | DEFINER | sql |
| is_curateur | — | DEFINER | sql |
| is_curation_staff | — | DEFINER | sql |
| is_medecin | — | DEFINER | sql |
| is_saisisseur | — | DEFINER | sql |
| is_strict_date_text | p_value text | INVOKER | plpgsql |
| is_strict_datetime_text | p_value text | INVOKER | plpgsql |
| is_system_admin | — | DEFINER | sql |
| jsonb_matches | p_data jsonb, p_conds jsonb | INVOKER | plpgsql |
| list_deleted_bases | — | DEFINER | plpgsql |
| list_recent_client_errors | p_limit integer, p_since timestamp with time zone, p_context text | DEFINER | plpgsql |
| log_attachment_read | p_attachment_id uuid | DEFINER | plpgsql |
| log_audit | p_action text, p_entity text, p_entity_id uuid, p_base_id uuid, p_metadata jsonb | DEFINER | plpgsql |
| log_export_read | p_export_id uuid | DEFINER | plpgsql |
| log_identity_read | p_patient_id uuid | DEFINER | plpgsql |
| log_raw_document_read | p_document_id uuid | DEFINER | plpgsql |
| log_sensitive_read | p_action text, p_entity text, p_entity_id uuid, p_base_id uuid | DEFINER | plpgsql |
| mission_account_lookup | p_email text | DEFINER | plpgsql |
| mission_accounts | p_base_id uuid | DEFINER | plpgsql |
| mission_accounts_owned | p_base_id uuid | DEFINER | plpgsql |
| mission_credential_envelope | p_access_id uuid | DEFINER | plpgsql |
| option_key_repair_plan | p_base_id uuid | DEFINER | sql |
| owns_base_with_member | p_user uuid | DEFINER | sql |
| owns_template | p_template uuid | DEFINER | sql |
| patient_age_at | p_patient_id uuid, p_at date, p_unit text | DEFINER | plpgsql |
| pgp_armor_headers | text, OUT key text, OUT value text | INVOKER | c |
| pgp_key_id | bytea | INVOKER | c |
| pgp_pub_decrypt | bytea, bytea | INVOKER | c |
| pgp_pub_decrypt | bytea, bytea, text | INVOKER | c |
| pgp_pub_decrypt | bytea, bytea, text, text | INVOKER | c |
| pgp_pub_decrypt_bytea | bytea, bytea | INVOKER | c |
| pgp_pub_decrypt_bytea | bytea, bytea, text | INVOKER | c |
| pgp_pub_decrypt_bytea | bytea, bytea, text, text | INVOKER | c |
| pgp_pub_encrypt | text, bytea | INVOKER | c |
| pgp_pub_encrypt | text, bytea, text | INVOKER | c |
| pgp_pub_encrypt_bytea | bytea, bytea | INVOKER | c |
| pgp_pub_encrypt_bytea | bytea, bytea, text | INVOKER | c |
| pgp_sym_decrypt | bytea, text | INVOKER | c |
| pgp_sym_decrypt | bytea, text, text | INVOKER | c |
| pgp_sym_decrypt_bytea | bytea, text | INVOKER | c |
| pgp_sym_decrypt_bytea | bytea, text, text | INVOKER | c |
| pgp_sym_encrypt | text, text | INVOKER | c |
| pgp_sym_encrypt | text, text, text | INVOKER | c |
| pgp_sym_encrypt_bytea | bytea, text | INVOKER | c |
| pgp_sym_encrypt_bytea | bytea, text, text | INVOKER | c |
| preview_option_key_repair | p_base_id uuid | DEFINER | plpgsql |
| promote_template_to_global | p_template_id uuid | DEFINER | plpgsql |
| provision_mission_access | p_base_id uuid, p_user_id uuid, p_expires_at timestamp with time zone, p_can_view_identity boolean, p_identity_justification text | DEFINER | plpgsql |
| publish_template_version | p_version_id uuid | DEFINER | plpgsql |
| purge_client_error_log | — | DEFINER | plpgsql |
| quarantine_reconciliation_candidates | p_limit integer | DEFINER | sql |
| recompute_encounter_age | — | DEFINER | plpgsql |
| reconcile_mission_profile | p_user_id uuid | DEFINER | plpgsql |
| record_client_error | p_occurred_at timestamp with time zone, p_name text, p_message text, p_stack text, p_component_stack text, p_context text, p_app_version text, p_severity text | DEFINER | plpgsql |
| record_quarantine_move | p_entity text, p_entity_id uuid, p_run_id uuid, p_user_id uuid, p_base_id uuid, p_source_bucket text, p_source_path text, p_quarantine_bucket text, p_quarantine_path text, p_engine text, p_signature text, p_file_hash text, p_file_size bigint, p_detected_mime_type text, p_mime_type text, p_extra jsonb | DEFINER | plpgsql |
| refresh_patient_inclusion_date | p_patient_id uuid | DEFINER | sql |
| reject_cross_sectional_encounter | — | DEFINER | plpgsql |
| reject_cross_sectional_encounter_submission | — | DEFINER | plpgsql |
| release_curation_task | p_task_id uuid | DEFINER | plpgsql |
| reorder_template_fields | p_version_id uuid, p_field_ids uuid[] | DEFINER | plpgsql |
| reorder_template_sections | p_version_id uuid, p_section_ids uuid[] | DEFINER | plpgsql |
| repair_option_keys | p_base_id uuid, p_confirm boolean | DEFINER | plpgsql |
| replay_encounter_update | p_operation_id text, p_encounter_id uuid, p_data jsonb, p_validation_status text, p_reason text, p_expected_updated_at timestamp with time zone | DEFINER | plpgsql |
| request_clarification | p_task_id uuid, p_question text | DEFINER | plpgsql |
| require_server_inspection | — | DEFINER | sql |
| resolve_option_key | p_options jsonb, p_value text | INVOKER | sql |
| restore_deleted_base | p_base_id uuid | DEFINER | plpgsql |
| revoke_base_access | p_access_id uuid | DEFINER | plpgsql |
| revoke_base_invitation | p_invitation_id uuid | DEFINER | plpgsql |
| revoke_mission_access | p_access_id uuid | DEFINER | plpgsql |
| rollback_verified_upload_operation | p_ticket_id uuid, p_user_id uuid, p_document_id uuid | DEFINER | plpgsql |
| rule_apply_op | op text, a jsonb, b jsonb | INVOKER | plpgsql |
| rule_cmp | a jsonb, b jsonb | INVOKER | plpgsql |
| rule_holds | rule jsonb, data jsonb | INVOKER | sql |
| rule_holds | rule jsonb, data jsonb, hidden text[] | INVOKER | plpgsql |
| rule_value_present | v jsonb | INVOKER | sql |
| save_curation_draft | p_draft_id uuid, p_patient_data jsonb, p_encounters jsonb, p_expected_revision bigint | DEFINER | plpgsql |
| scrub_client_error_text | p_value text, p_max_length integer | INVOKER | plpgsql |
| search_terminology | p_query text, p_limit integer | INVOKER | sql |
| set_base_inclusion_target | p_base_id uuid, p_target integer, p_target_date date, p_expected_revision bigint | DEFINER | plpgsql |
| set_base_observation_model | p_base_id uuid, p_observation_model text | DEFINER | plpgsql |
| set_base_template_version | p_base_id uuid, p_version_id uuid | DEFINER | plpgsql |
| set_updated_at | — | INVOKER | plpgsql |
| soft_delete_attachment | p_attachment_id uuid, p_reason text | DEFINER | plpgsql |
| soft_delete_base | p_base_id uuid, p_reason text | DEFINER | plpgsql |
| soft_delete_encounter | p_encounter_id uuid, p_reason text | DEFINER | plpgsql |
| soft_delete_patient | p_patient_id uuid, p_reason text | DEFINER | plpgsql |
| submit_curation_request | p_task_id uuid | DEFINER | plpgsql |
| sync_template_field_section | — | DEFINER | plpgsql |
| template_field_in_use | p_field_id uuid | DEFINER | sql |
| template_field_option_keys | p_options jsonb | INVOKER | sql |
| template_field_options_from_values | p_values jsonb, p_previous jsonb | INVOKER | sql |
| template_of_version | p_version uuid | DEFINER | sql |
| template_version_fields_in_use | p_version_id uuid | DEFINER | sql |
| template_version_in_use | p_version_id uuid | DEFINER | sql |
| template_version_locked | p_version_id uuid | DEFINER | sql |
| terminology_normalize | p_text text | INVOKER | sql |
| trg_audit_access_fn | — | DEFINER | plpgsql |
| trg_audit_export_fn | — | DEFINER | plpgsql |
| trg_audit_invitation_fn | — | DEFINER | plpgsql |
| trg_audit_template_publish_fn | — | DEFINER | plpgsql |
| trg_refresh_patient_inclusion_date | — | DEFINER | plpgsql |
| update_base_access_permissions | p_access_id uuid, p_can_view_identity boolean, p_can_view_raw_documents boolean, p_can_edit_structured_data boolean, p_can_export_data boolean, p_can_manage_access boolean | DEFINER | plpgsql |
| update_encounter | p_encounter_id uuid, p_data jsonb, p_validation_status text, p_reason text, p_expected_updated_at timestamp with time zone | DEFINER | plpgsql |
| update_patient | p_patient_id uuid, p_data jsonb, p_validation_status text, p_reason text | DEFINER | plpgsql |
| update_patient | p_patient_id uuid, p_data jsonb, p_validation_status text, p_reason text, p_expected_version bigint | DEFINER | plpgsql |
| update_patient_identity | p_patient_id uuid, p_full_name text, p_date_of_birth date, p_phone text, p_address text, p_external_identifier text, p_reason text, p_expected_version bigint | DEFINER | plpgsql |
| update_quarantine_move | p_move_id uuid, p_status text, p_last_error text | DEFINER | plpgsql |
| update_template_field | p_field_id uuid, p_field_key text, p_label text, p_description text, p_default_value text, p_scope text, p_section text, p_type text, p_required boolean, p_encounter_types text[], p_allowed_values jsonb, p_min_value numeric, p_max_value numeric, p_unit text, p_allow_missing_codes boolean | DEFINER | plpgsql |
| update_template_field | p_field_id uuid, p_field_key text, p_label text, p_description text, p_default_value text, p_scope text, p_section text, p_type text, p_required boolean, p_is_multiple boolean, p_missing_reasons text[], p_allowed_options jsonb, p_encounter_types text[], p_allowed_values jsonb, p_min_value numeric, p_max_value numeric, p_unit text | DEFINER | plpgsql |
| update_template_field | p_field_id uuid, p_field_key text, p_label text, p_description text, p_default_value text, p_scope text, p_section text, p_type text, p_required boolean, p_missing_reasons text[], p_allowed_options jsonb, p_encounter_types text[], p_allowed_values jsonb, p_min_value numeric, p_max_value numeric, p_unit text | DEFINER | plpgsql |
| update_template_field | p_field_id uuid, p_field_key text, p_label text, p_description text, p_default_value text, p_scope text, p_section text, p_type text, p_required boolean, p_missing_reasons text[], p_encounter_types text[], p_allowed_values jsonb, p_min_value numeric, p_max_value numeric, p_unit text | DEFINER | plpgsql |
| update_template_field | p_field_id uuid, p_field_key text, p_label text, p_description text, p_scope text, p_section text, p_type text, p_required boolean, p_encounter_types text[], p_allowed_values jsonb, p_min_value numeric, p_max_value numeric, p_unit text, p_allow_missing_codes boolean | DEFINER | plpgsql |
| update_template_field | p_field_id uuid, p_field_key text, p_label text, p_scope text, p_section text, p_type text, p_required boolean, p_encounter_types text[], p_allowed_values jsonb, p_min_value numeric, p_max_value numeric, p_unit text, p_allow_missing_codes boolean | DEFINER | plpgsql |
| upload_ticket_authorized | p_base_id uuid, p_bucket text | DEFINER | sql |
| validation_rank | p_status text | INVOKER | sql |
| value_cmp | a text, b text | INVOKER | plpgsql |
| value_documented | v jsonb | INVOKER | sql |
| value_missing_code | v jsonb | INVOKER | sql |
| visibility_hidden_fields | p_version uuid, p_data jsonb | INVOKER | plpgsql |
