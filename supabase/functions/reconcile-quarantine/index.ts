// Reconciliation operationnelle des mouvements de quarantaine non atomiques Storage <-> SQL
// (audit v20 §7.2). Reservee aux system_admin. Adaptateur mince : la logique est dans handler.ts.
import { createClient } from '@supabase/supabase-js';
import { supabaseEnvironment } from '../_shared/contracts.ts';
import { handleReconcileQuarantine } from './handler.ts';

Deno.serve((req: Request) =>
  handleReconcileQuarantine(req, {
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
    nowIso: () => new Date().toISOString(),
  })
);
