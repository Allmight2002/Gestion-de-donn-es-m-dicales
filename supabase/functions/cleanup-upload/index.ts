// Nettoyage serveur des objets Storage orphelins : adaptateur mince. La logique (verification RLS +
// propriete du ticket, reservation, suppression, journalisation) est dans handler.ts, testee sans
// deploiement.
import { createClient } from '@supabase/supabase-js';
import { supabaseEnvironment } from '../_shared/contracts.ts';
import { handleCleanupUpload } from './handler.ts';

Deno.serve((req: Request) =>
  handleCleanupUpload(req, {
    buildClients: (auth) => {
      const env = supabaseEnvironment();
      return {
        asUser: createClient(env.url, env.anonKey, {
          global: { headers: { Authorization: auth } },
          auth: { persistSession: false },
        }),
        admin: createClient(env.url, env.serviceRoleKey, { auth: { persistSession: false } }),
      };
    },
    now: () => Date.now(),
    nowIso: () => new Date().toISOString(),
  })
);
