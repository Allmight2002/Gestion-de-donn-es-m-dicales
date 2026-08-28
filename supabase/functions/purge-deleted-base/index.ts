// Adaptateur Edge D10. Le service_role reste confine ici et n'est jamais expose au client.
import { createClient } from '@supabase/supabase-js';
import { supabaseEnvironment } from '../_shared/contracts.ts';
import { handlePurgeDeletedBase } from './handler.ts';

Deno.serve((req: Request) =>
  handlePurgeDeletedBase(req, {
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
  })
);
