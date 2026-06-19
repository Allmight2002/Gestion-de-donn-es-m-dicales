// Adaptateur : implemente AuthBackend a partir d'un client Supabase.
import type { SupabaseClient } from '@supabase/supabase-js';
import { type AuthBackend, unconfiguredBackend } from '../auth/backend';
import { mapProfileRow, type ProfileRow } from '../auth/logic';
import type { SessionUser } from '../auth/types';
import { supabase } from './supabase';

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

    async signIn(email, password) {
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
    },

    async signOut() {
      await client.auth.signOut();
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
      const { error } = await client.auth.resetPasswordForEmail(email);
      if (error) throw error;
    },
  };
}

export const supabaseBackend: AuthBackend = makeSupabaseBackend(supabase);
