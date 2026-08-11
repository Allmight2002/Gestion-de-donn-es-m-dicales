import { createClient } from '@supabase/supabase-js';
import { requiredEnv, supabaseEnvironment } from '../_shared/contracts.ts';
import { createCredentialCipher } from './credentials.ts';
import { handleCreateMissionAccount } from './handler.ts';

let cipherPromise: ReturnType<typeof createCredentialCipher> | null = null;

Deno.serve(async (req: Request) => {
  try {
    const env = supabaseEnvironment();
    const admin = createClient(env.url, env.serviceRoleKey, { auth: { persistSession: false } });
    cipherPromise ??= createCredentialCipher(
      requiredEnv(['MISSION_CREDENTIALS_ENCRYPTION_KEY']).MISSION_CREDENTIALS_ENCRYPTION_KEY,
    );
    const cipher = await cipherPromise;

    return await handleCreateMissionAccount(req, {
      cipher,
      buildClients: (auth) => ({
        asUser: createClient(env.url, env.anonKey, {
          global: { headers: { Authorization: auth } },
          auth: { persistSession: false },
        }),
        admin,
      }),
      auth: {
        getMissionUser: async (userId) => {
          const { data, error } = await admin.auth.admin.getUserById(userId);
          if (error) {
            if (error.status === 404) return {};
            return { error: 'verification refusee' };
          }
          const user = data.user;
          if (!user) return {};
          const generation = user.app_metadata?.mission_credential_generation;
          return {
            user: {
              userId: user.id,
              email: user.email ?? null,
              globalRole: typeof user.app_metadata?.global_role === 'string' ? user.app_metadata.global_role : null,
              credentialGeneration: Number.isInteger(generation) ? Number(generation) : null,
            },
          };
        },
        createMissionUser: async (input) => {
          const { data, error } = await admin.auth.admin.createUser({
            id: input.userId,
            email: input.email,
            password: input.password,
            email_confirm: true,
            app_metadata: {
              global_role: 'saisisseur',
              mission_credential_generation: input.credentialGeneration,
            },
            user_metadata: { full_name: input.accountLabel, language: 'fr' },
          });
          if (error || !data?.user?.id) return { error: 'creation refusee' };
          return { userId: data.user.id };
        },
        updateMissionCredentials: async (input) => {
          const { error } = await admin.auth.admin.updateUserById(input.userId, {
            email: input.email,
            password: input.password,
            email_confirm: true,
            ban_duration: 'none',
            app_metadata: {
              global_role: 'saisisseur',
              mission_credential_generation: input.credentialGeneration,
            },
          });
          return error ? { error: 'mise a jour refusee' } : {};
        },
        banMissionUser: async (userId) => {
          const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: '876000h' });
          return error ? { error: 'blocage refuse' } : {};
        },
      },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Configuration serveur indisponible' }), {
      status: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        'content-type': 'application/json',
      },
    });
  }
});
