-- =============================================================================
-- 20260616092900_rpc_only_clinical_writes.sql  (audit 3 §5.3)
-- Les politiques UPDATE directes sur patient / encounter / patient_identity permettaient a un
-- editeur de modifier des donnees (date/type de rencontre, statut, data, identite...) en
-- CONTOURNANT les RPC -> sans journal (field_change_log), sans recalcul d'age, sans audit.
-- Correctif : RETIRER l'UPDATE direct. Toutes les ecritures legitimes passent par des RPC
-- SECURITY DEFINER (create_patient, create_encounter, update_encounter, finalize_patient,
-- soft_delete_*, import_records) qui, hors FORCE RLS, contournent la RLS -> aucun flux casse.
-- Le frontend ne fait que des SELECT sur ces tables (verifie). Les triggers §5.2 (anti-
-- retrogradation, recalcul d'age) restent en defense sur la voie RPC. INSERT inchange
-- (creation via RPC ; pas de modification d'existant possible sans UPDATE/DELETE).
-- Migration ADDITIVE.
-- =============================================================================

drop policy if exists p_update  on public.patient;
drop policy if exists e_update  on public.encounter;
drop policy if exists pi_update on public.patient_identity;
