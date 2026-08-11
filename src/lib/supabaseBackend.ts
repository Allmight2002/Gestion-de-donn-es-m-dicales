// Adaptateur : implemente AuthBackend a partir d'un client Supabase.
import type { SupabaseClient } from '@supabase/supabase-js';
import { type AuthBackend, unconfiguredBackend } from '../auth/backend';
import { mapProfileRow, type ProfileRow } from '../auth/logic';
import type { SessionUser } from '../auth/types';
import { SUPABASE_URL } from './env';
import { supabase } from './supabase';

type RuntimeAuthStorage = {
  storageKey?: string;
  storage?: { removeItem(key: string): void | Promise<void> };
};

function configuredAuthStorageKey(): string | null {
  try {
    return SUPABASE_URL ? `sb-${new URL(SUPABASE_URL).hostname.split('.')[0]}-auth-token` : null;
  } catch {
    return null;
  }
}

async function removePersistedAuthSession(client: SupabaseClient): Promise<void> {
  // auth-js ne supprime pas sa session si l'appel /logout echoue hors-ligne. La version verrouillee
  // expose au runtime le storage et sa cle (proteges seulement au niveau TypeScript) : on les lit
  // pour retirer la session, puis on repasse par signOut(local) afin d'emettre SIGNED_OUT.
  const runtime = client.auth as unknown as RuntimeAuthStorage;
  const storageKey = runtime.storageKey || configuredAuthStorageKey();
  if (!storageKey) return;
  for (const key of [storageKey, `${storageKey}-code-verifier`, `${storageKey}-user`]) {
    try {
      if (runtime.storage?.removeItem) await runtime.storage.removeItem(key);
      else if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
    } catch {
      try { if (typeof localStorage !== 'undefined') localStorage.removeItem(key); } catch { /* fermeture locale best-effort */ }
    }
  }
}

async function signOutIncludingOffline(client: SupabaseClient): Promise<void> {
  try {
    const { error } = await client.auth.signOut();
    if (!error) return;
  } catch { /* reseau absent : forcer l'effacement de la session persistante ci-dessous */ }

  await removePersistedAuthSession(client);
  try {
    // Sans session persistante, auth-js n'appelle plus le reseau et execute son nettoyage interne
    // (epoch anti-refresh concurrent + notification SIGNED_OUT).
    await client.auth.signOut({ scope: 'local' });
  } catch { /* la suppression persistante reste l'exigence de securite minimale */ }
  // Garde finale si une implementation future tente de restaurer la session pendant la notification.
  await removePersistedAuthSession(client);
}

export function makeSupabaseBackend(client: SupabaseClient | null): AuthBackend {
  if (!client) return unconfiguredBackend;

  const toUser = (u: { id: string; email?: string | null } | null | undefined): SessionUser | null =>
    u ? { id: u.id, email: u.email ?? null } : null;

  return {
    configured: true,

    async getSession() {
      const { data } = await client.auth.getSession();
      return toUser(data.session?.user ?? null);
    },

    onAuthChange(callback) {
      const { data } = client.auth.onAuthStateChange((_event, session) => {
        callback(toUser(session?.user ?? null));
      });
      return () => data.subscription.unsubscribe();
    },

    async signIn(identifier, password) {
      const normalized = identifier.trim().toLowerCase();
      const email = normalized.includes('@') ? normalized : `${normalized}@mission.meddata.invalid`;
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
    },

    async signOut() {
      await signOutIncludingOffline(client);
    },

    async fetchProfile(userId) {
      const { data, error } = await client
        .from('profiles')
        .select('id, full_name, global_role, language')
        .eq('id', userId)
        .single();
      if (error) throw error;
      return mapProfileRow(data as ProfileRow);
    },

    async sendPasswordReset(email) {
      // Le lien de l'email renvoie vers l'ecran de definition du nouveau mot de passe.
      const redirectTo = typeof window !== 'undefined' ? `${window.location.origin}/reset-password` : undefined;
      const { error } = await client.auth.resetPasswordForEmail(email, redirectTo ? { redirectTo } : undefined);
      if (error) throw error;
    },

    async updatePassword(newPassword) {
      const { error } = await client.auth.updateUser({ password: newPassword });
      if (error) throw error;
    },
  };
}

export const supabaseBackend: AuthBackend = makeSupabaseBackend(supabase);
