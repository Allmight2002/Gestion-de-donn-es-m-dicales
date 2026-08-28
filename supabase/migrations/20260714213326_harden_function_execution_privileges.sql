-- Ferme l'exposition implicite des fonctions public par PostgREST/GraphQL.
-- Aucun parcours anonyme n'est requis par MedData : toute RPC metier exige un JWT.
revoke execute on all functions in schema public from public, anon;

-- Les nouvelles fonctions sont privees par defaut. Toute nouvelle RPC cliente doit
-- desormais recevoir un GRANT explicite dans sa migration de creation.
alter default privileges
  revoke execute on functions from public, anon, authenticated;

-- Les anciennes migrations ont ete creees alors que Supabase accordait EXECUTE a
-- authenticated par defaut. Les fonctions SECURITY INVOKER historiques restent
-- accessibles (elles conservent les droits et la RLS de l'appelant). Pour les
-- SECURITY DEFINER, on conserve uniquement les RPC applicatives et les helpers
-- indispensables aux politiques RLS/Storage. Les surcharges historiques d'un meme
-- nom restent disponibles pour ne pas casser les clients compatibles.
do $function_acl$
declare
  v_function record;
  v_authenticated_names constant text[] := array[
    'accept_invitation',
    'answer_clarification',
    'archive_template_version',
    'base_activity_log',
    'base_completeness_stats',
    'base_completion_queue',
    'base_completion_queue_page',
    'base_identity_audit',
    'base_inclusion_stats',
    'base_of_cohort',
    'base_of_patient',
    'begin_import_batch',
    'can_curate',
    'can_edit_structured_data',
    'can_export_data',
    'can_manage_access',
    'can_read_template',
    'can_view_identity',
    'can_view_raw_documents',
    'can_write_identity',
    'cancel_import_batch',
    'claim_curation_task',
    'cohort_preview',
    'complete_import_batch',
    'create_base_from_model',
    'create_base_invitation',
    'create_cohort_snapshot',
    'create_curation_submission',
    'create_encounter',
    'create_next_personal_template_version',
    'create_patient',
    'create_patient_curation_submission',
    'create_template_bundle',
    'create_upload_operation',
    'create_upload_ticket',
    'curation_pool',
    'delete_curation_request',
    'delete_template',
    'delete_template_field',
    'detect_import_duplicates',
    'download_base_snapshot',
    'duplicate_template_version',
    'ensure_curation_draft',
    'finalize_curation_task',
    'finalize_patient',
    'finalize_upload_operation',
    'find_identity_matches',
    'get_import_batch_state',
    'get_patient_identity',
    'has_base_access',
    'has_pending_upload_ticket',
    'import_records',
    'is_active_assigned_curator',
    'is_assigned_curator',
    'is_assigned_to_submission',
    'is_base_active',
    'is_base_owner',
    'is_curateur',
    'is_medecin',
    'is_system_admin',
    'log_attachment_read',
    'log_export_read',
    'log_identity_read',
    'log_raw_document_read',
    'owns_base_with_member',
    'owns_template',
    'patient_age_at',
    'promote_template_to_global',
    'publish_template_version',
    'release_curation_task',
    'reorder_template_fields',
    'replay_encounter_update',
    'request_clarification',
    'require_server_inspection',
    'revoke_base_access',
    'revoke_base_invitation',
    'save_curation_draft',
    'set_base_inclusion_target',
    'set_base_template_version',
    'soft_delete_attachment',
    'soft_delete_base',
    'soft_delete_encounter',
    'soft_delete_patient',
    'submit_curation_request',
    'template_field_in_use',
    'template_of_version',
    'template_version_fields_in_use',
    'template_version_in_use',
    'update_base_access_permissions',
    'update_encounter',
    'update_patient',
    'update_template_field'
  ];
begin
  for v_function in
    select
      n.nspname as schema_name,
      p.proname as function_name,
      p.prosecdef as security_definer,
      pg_get_function_identity_arguments(p.oid) as identity_arguments
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
  loop
    if not v_function.security_definer
       or v_function.function_name = any(v_authenticated_names) then
      execute format(
        'grant execute on function %I.%I(%s) to authenticated',
        v_function.schema_name,
        v_function.function_name,
        v_function.identity_arguments
      );
    elsif v_function.security_definer then
      execute format(
        'revoke execute on function %I.%I(%s) from authenticated',
        v_function.schema_name,
        v_function.function_name,
        v_function.identity_arguments
      );
    end if;
  end loop;
end
$function_acl$;

-- Les quatre fonctions signalees par l'advisor n'avaient aucun search_path fixe.
-- Elles n'ont besoin que des built-ins, sauf jsonb_matches qui appelle value_cmp.
alter function public.compute_age(date, date, text)
  set search_path = pg_catalog, pg_temp;
alter function public.set_updated_at()
  set search_path = pg_catalog, pg_temp;
alter function public.value_cmp(text, text)
  set search_path = pg_catalog, pg_temp;
alter function public.jsonb_matches(jsonb, jsonb)
  set search_path = pg_catalog, public, pg_temp;
