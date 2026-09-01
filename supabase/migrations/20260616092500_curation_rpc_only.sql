-- =============================================================================
-- 20260616092500_curation_rpc_only.sql  (v3.0)
-- Audit §5.1 : un curateur AFFECTE pouvait CLORE une tache directement
--   update curation_task set status='completed' where id=...
-- court-circuitant tout le cycle (aucun brouillon, aucune finalisation, aucune donnee
-- integree). La politique ct_update autorisait l'UPDATE de TOUTES les colonnes.
-- Correctif : RETIRER l'UPDATE direct sur curation_task ET raw_submission. Toutes les
-- transitions passent deja par des RPC SECURITY DEFINER (claim / release / request_clarification
-- / answer_clarification / submit / finalize / delete) qui, hors FORCE RLS, contournent la RLS
-- -> aucun flux legitime casse. Le frontend ne fait que des SELECT sur ces tables.
-- Lecture (ct_select / rs_select) et insertion (ct_insert / rs_insert) inchangees.
-- Migration ADDITIVE.
-- =============================================================================

drop policy if exists ct_update on public.curation_task;
drop policy if exists rs_update on public.raw_submission;
