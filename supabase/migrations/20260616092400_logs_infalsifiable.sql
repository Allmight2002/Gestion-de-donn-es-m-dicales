-- =============================================================================
-- 20260616092400_logs_infalsifiable.sql  (v3.0)
-- Audit §5.5 : les journaux pouvaient etre FABRIQUES par appel direct.
--   - audit_log : `al_insert` autorisait tout INSERT tant que user_id = auth.uid()
--     -> un utilisateur pouvait inventer un evenement (action arbitraire) sur la base
--        d'un AUTRE medecin.
--   - field_change_log : `fcl_insert` autorisait un editeur a inserer des lignes d'historique
--     directement (sans correction reelle).
-- Correctif : RETIRER l'INSERT direct. Toutes les ecritures legitimes passent par des
-- fonctions SECURITY DEFINER (log_audit, log_sensitive_read, update_encounter, import_records,
-- RPC de curation...) qui, possedees par le proprietaire et hors FORCE RLS, contournent la
-- RLS -> aucun flux legitime casse. Le frontend journalise deja via la RPC log_sensitive_read
-- (jamais d'insert direct). Lecture (al_select / fcl_select) inchangee.
-- Migration ADDITIVE.
-- =============================================================================

drop policy if exists al_insert on public.audit_log;
drop policy if exists fcl_insert on public.field_change_log;
