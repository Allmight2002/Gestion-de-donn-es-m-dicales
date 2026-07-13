// Generation serveur des exports scientifiques (audit v20 §7.6) : adaptateur mince. Toute la logique
// (lecture cohorte, construction CSV/XLSX, upload, journalisation transactionnelle) est dans handler.ts,
// testee sans deploiement.
import { createClient } from '@supabase/supabase-js';
import { supabaseEnvironment } from '../_shared/contracts.ts';
import { handleGenerateExport } from './handler.ts';

Deno.serve((req: Request) =>
  handleGenerateExport(req, {
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
    newId: () => crypto.randomUUID(),
    now: () => Date.now(),
    nowIso: () => new Date().toISOString(),
  })
);
