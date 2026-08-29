// Lecture des variables d'environnement frontend.
//
// SECURITE (cahier §12) : seules les variables prefixees VITE_ sont disponibles
// cote navigateur. La cle service_role n'a PAS ce prefixe et n'est donc jamais
// accessible ici ni dans le bundle. Le frontend n'utilise QUE la cle anon.

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

const PLACEHOLDERS = new Set([
  undefined,
  '',
  'remplacer_par_la_cle_anon',
  'http://127.0.0.1:54321', // valeur d'exemple : consideree non configuree tant que la cle manque
]);

export const isSupabaseConfigured =
  !!SUPABASE_URL &&
  !!SUPABASE_ANON_KEY &&
  !PLACEHOLDERS.has(SUPABASE_ANON_KEY);
