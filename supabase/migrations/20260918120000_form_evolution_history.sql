-- =============================================================================
-- 20260918120000_form_evolution_history.sql  (lot E6 — historique d'une evolution)
-- =============================================================================
-- Additive. Aucune table, aucune colonne, aucune donnee touchee.
--
-- E2 journalise deja `form_preparation_applied` avec l'auteur, la date, les revisions
-- source/cible, la classification et l'impact calcule PAR LE SERVEUR au moment de
-- l'application. Mais `activity_public_metadata` retombait sur sa branche `else` : le journal
-- d'activite montrait « une evolution a eu lieu », sans dire laquelle. Le critere E6 demande
-- auteur, date, impact ET revision.
--
-- Ce qui sort d'ici est un INSTANTANE : les compteurs et la classification sont ceux que
-- `apply_form_preparation` a figes dans `audit_log.metadata`. Aucune ligne ne pointe vers la
-- version de gabarit vivante, qui pourrait changer et faire mentir l'historique a posteriori.
--
-- Minimisation : tout titulaire d'un acces a la base voit les COMPTEURS et les revisions ; les
-- cles de variables ajoutees, qui decrivent la structure nominative du formulaire, restent
-- reservees au proprietaire, comme la signature d'un fichier inspecte.

create or replace function public.activity_public_metadata(
  p_action text,
  p_metadata jsonb,
  p_is_owner boolean
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when p_action = 'data_imported' then jsonb_strip_nulls(jsonb_build_object(
      'patients_new', p_metadata -> 'patients_new',
      'patients_updated', p_metadata -> 'patients_updated',
      'encounters', p_metadata -> 'encounters',
      'errors', coalesce(p_metadata -> 'errors', p_metadata -> 'error_count')
    ))
    when p_action in ('access_granted', 'access_changed', 'invitation_created') then jsonb_strip_nulls(jsonb_build_object(
      'access_role', p_metadata -> 'access_role'
    ))
    when p_action = 'export_created' then jsonb_strip_nulls(jsonb_build_object(
      'format', p_metadata -> 'format',
      'patient_count', p_metadata -> 'patient_count',
      'encounter_count', p_metadata -> 'encounter_count'
    ))
    when p_action = 'template_published' then jsonb_strip_nulls(jsonb_build_object(
      'version_number', p_metadata -> 'version_number'
    ))
    when p_action = 'file_inspected' then jsonb_strip_nulls(jsonb_build_object(
      'status', p_metadata -> 'status',
      'engine', p_metadata -> 'engine',
      'file_size', p_metadata -> 'file_size',
      'detected_mime_type', p_metadata -> 'detected_mime_type',
      'signature', case when p_is_owner then p_metadata -> 'signature' else null end
    ))
    -- E6 : l'evolution du formulaire, lisible sans ouvrir la base de donnees.
    when p_action = 'form_preparation_applied' then jsonb_strip_nulls(jsonb_build_object(
      'classification', p_metadata -> 'classification',
      'source_revision', p_metadata -> 'source_revision',
      'target_revision', p_metadata -> 'target_revision',
      'added_fields', jsonb_array_length(
        coalesce(p_metadata #> '{impact,addedFields}', '[]'::jsonb)
      ),
      'added_required_fields', (
        select count(*)
          from jsonb_array_elements(coalesce(p_metadata #> '{impact,addedFields}', '[]'::jsonb)) f(value)
         where coalesce((f.value ->> 'required')::boolean, false)
      ),
      'added_sections', jsonb_array_length(
        coalesce(p_metadata #> '{impact,addedSections}', '[]'::jsonb)
      ),
      'added_rules', jsonb_array_length(
        coalesce(p_metadata #> '{impact,addedRules}', '[]'::jsonb)
      ),
      'added_diagnosis_associations', jsonb_array_length(
        coalesce(p_metadata #> '{impact,addedDiagnosisAssociations}', '[]'::jsonb)
      ),
      -- Les fiches POTENTIELLEMENT concernees : un compte, jamais une liste de dossiers.
      -- La liste nominative reste soumise aux droits de lecture des fiches elles-memes.
      'affected_patients', p_metadata #> '{impact,serverCounts,patients}',
      'affected_encounters', p_metadata #> '{impact,serverCounts,encounters}',
      -- Reserve au proprietaire : le detail nominatif de la structure ajoutee.
      'added_field_keys', case
        when p_is_owner then (
          select jsonb_agg(f.value ->> 'fieldKey' order by f.value ->> 'fieldKey')
            from jsonb_array_elements(coalesce(p_metadata #> '{impact,addedFields}', '[]'::jsonb)) f(value)
        )
        else null
      end
    ))
    when p_action in ('patient_deleted', 'encounter_deleted', 'base_deleted') and p_is_owner then
      -- E5/E6 : le proprietaire dispense de motif laisse `reason` nul. `jsonb_strip_nulls`
      -- retire alors la cle : l'historique n'affiche pas de motif, et n'en invente aucun.
      jsonb_strip_nulls(jsonb_build_object('reason', p_metadata -> 'reason'))
    else '{}'::jsonb
  end
$$;
revoke all on function public.activity_public_metadata(text, jsonb, boolean) from public, anon, authenticated;
