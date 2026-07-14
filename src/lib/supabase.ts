// Client Supabase du frontend (cle ANON uniquement).
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, isSupabaseConfigured } from './env';
import { createReadTimeoutFetch } from './network';

// null quand l'environnement n'est pas configure -> l'UI affiche un ecran dedie
// plutot que de planter.
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(SUPABASE_URL as string, SUPABASE_ANON_KEY as string, {
    global: { fetch: createReadTimeoutFetch() },
  })
  : null;
