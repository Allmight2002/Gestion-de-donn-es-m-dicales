// Client Supabase du frontend (cle ANON uniquement).
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, isSupabaseConfigured } from './env';
import { createReadTimeoutFetch } from './network';

// null quand l'environnement n'est pas configure -> l'UI affiche un ecran dedie
// plutot que de planter.
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(SUPABASE_URL as string, SUPABASE_ANON_KEY as string, {
    // ATTENTION : ces en-tetes partent sur TOUTES les requetes Supabase, Edge Functions
    // comprises. Tout ajout ici doit etre repris dans les listes `Access-Control-Allow-Headers`
    // des Edge Functions, sinon le navigateur rejette leur preflight et la requete n'est jamais
    // envoyee -- sans aucune trace serveur. Verrouille par test/cors-contract.test.ts.
    global: { fetch: createReadTimeoutFetch(), headers: { 'x-meddata-diagnosis-contract': '1' } },
  })
  : null;
