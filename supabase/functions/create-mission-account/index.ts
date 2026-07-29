import { createClient } from '@supabase/supabase-js';
import { supabaseEnvironment } from '../_shared/contracts.ts';
import { handleCreateMissionAccount } from './handler.ts';

// Le role de mission doit etre porte par app_metadata DES l'insertion dans auth.users :
// c'est la seule facon pour handle_new_user de creer directement un profil `saisisseur`.
// inviteUserByEmail ne sait ecrire que user_metadata (modifiable par l'utilisateur) : le
// compte serait donc medecin le temps d'une invitation. On cree donc le compte avec
// app_metadata, puis on envoie un courriel de definition de mot de passe — l'etudiant
// reste seul detenteur de son secret, ce que la spec exige (§2, imputabilite).
Deno.serve((req: Request) =>
  handleCreateMissionAccount(req, {
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
    auth: {
      createMissionUser: async (email: string) => {
        const env = supabaseEnvironment();
        const admin = createClient(env.url, env.serviceRoleKey, { auth: { persistSession: false } });
        const { data, error } = await admin.auth.admin.createUser({
          email,
          email_confirm: false,
          app_metadata: { global_role: 'saisisseur' },
        });
        if (error || !data?.user?.id) return { error: 'creation refusee' };
        return { userId: data.user.id };
      },
      sendPasswordSetup: async (email: string) => {
        const env = supabaseEnvironment();
        const anon = createClient(env.url, env.anonKey, { auth: { persistSession: false } });
        // Redirection facultative : sans elle, Supabase utilise l'URL de site du projet.
        const redirectTo = Deno.env.get('MISSION_PASSWORD_REDIRECT_URL') ?? undefined;
        const { error } = await anon.auth.resetPasswordForEmail(email, redirectTo ? { redirectTo } : undefined);
        return error ? { error: 'envoi refuse' } : {};
      },
    },
  })
);
