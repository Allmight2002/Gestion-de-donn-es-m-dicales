-- L11 -- Sur Supabase, pgcrypto est installe dans le schema extensions.
-- La RPC SECURITY DEFINER calcule l'empreinte d'incident avec digest(); rendre
-- ce schema explicite evite toute resolution implicite, sans modifier le corps,
-- les droits, les donnees ni les politiques existantes.

alter function public.record_client_error(
  timestamptz, text, text, text, text, text, text, text
) set search_path = public, extensions, pg_temp;

notify pgrst, 'reload schema';
