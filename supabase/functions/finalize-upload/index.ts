import { createClient } from '@supabase/supabase-js';
import { supabaseEnvironment } from '../_shared/contracts.ts';
import { handleFinalizeUpload } from './handler.ts';

Deno.serve((req: Request) =>
  handleFinalizeUpload(req, {
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
