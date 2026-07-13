// Fonction Edge Supabase (runtime Deno) : adaptateur mince. Toute la logique (autorisation via RLS,
// journalisation audit_log AVANT livraison, signature service_role) est dans handler.ts, testee sans
// deploiement. Voir handler.ts pour le detail des garanties (audit §10.1, §9.3).
//
// Appel cote client : supabase.functions.invoke('signed-read', { body: { entity, id } })
//   entity = 'attachment' (image clinique) | 'raw_document' (document du pool) | 'export'
import { createClient } from '@supabase/supabase-js';
import { supabaseEnvironment } from '../_shared/contracts.ts';
import { handleSignedRead } from './handler.ts';

Deno.serve((req: Request) =>
  handleSignedRead(req, {
    buildClients: (auth) => {
      const env = supabaseEnvironment();
      return {
        // Client CONTEXTE UTILISATEUR (RLS appliquee) — sert UNIQUEMENT a autoriser.
        asUser: createClient(env.url, env.anonKey, {
          global: { headers: { Authorization: auth } },
          auth: { persistSession: false },
        }),
        // Client SERVICE_ROLE — journalise + signe (jamais expose au navigateur).
        admin: createClient(env.url, env.serviceRoleKey, { auth: { persistSession: false } }),
      };
    },
    requireInspection: () => Deno.env.get('REQUIRE_SERVER_INSPECTION') === 'true',
  })
);
