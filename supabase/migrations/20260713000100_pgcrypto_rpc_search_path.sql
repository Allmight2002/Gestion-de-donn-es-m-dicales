-- Deux RPC transactionnelles utilisent pgcrypto.digest(). Sur Supabase, pgcrypto
-- est installe dans le schema `extensions`; leur search_path SECURITY DEFINER doit
-- donc inclure explicitement ce schema. ALTER FUNCTION preserve les corps, grants
-- et donnees existants tout en corrigeant la resolution au runtime.

alter function public.create_patient_curation_submission(
  uuid, text, text, date, text, text, text, text
) set search_path = public, extensions, pg_temp;

alter function public.create_template_bundle(jsonb, uuid)
  set search_path = public, extensions, pg_temp;
