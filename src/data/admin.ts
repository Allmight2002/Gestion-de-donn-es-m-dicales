// Couche d'acces "administration" (cahier v3.0) : l'admin systeme attribue les roles
// globaux. La RLS (profiles_select_admin + guard_profile_role) garantit que seul un
// system_admin lit tous les profils et modifie un global_role -> aucune cle service_role
// cote frontend.
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { GlobalRole } from '../auth/types';

/** Roles attribuables par l'admin via l'UI (le system_admin n'est pas accorde ici). */
export const ASSIGNABLE_ROLES: GlobalRole[] = ['medecin', 'curateur', 'validateur', 'analyste'];

export interface AdminProfile {
  id: string;
  fullName: string;
  globalRole: GlobalRole;
}

export interface AdminRepository {
  listProfiles(): Promise<AdminProfile[]>;
  setGlobalRole(userId: string, role: GlobalRole): Promise<void>;
}

const NOT_CONFIGURED = 'Backend Supabase non configure';

type ProfileRow = { id: string; full_name: string | null; global_role: GlobalRole };

export function makeAdminRepository(client: SupabaseClient | null): AdminRepository {
  if (!client) {
    const fail = async (): Promise<never> => {
      throw new Error(NOT_CONFIGURED);
    };
    return { listProfiles: fail, setGlobalRole: fail };
  }

  return {
    async listProfiles() {
      const { data, error } = await client
        .from('profiles')
        .select('id, full_name, global_role')
        .order('global_role', { ascending: true });
      if (error) throw error;
      return ((data ?? []) as ProfileRow[]).map((r) => ({
        id: r.id, fullName: r.full_name ?? '', globalRole: r.global_role,
      }));
    },

    async setGlobalRole(userId, role) {
      const { error } = await client.from('profiles').update({ global_role: role }).eq('id', userId);
      if (error) throw error;
    },
  };
}

export const adminRepository: AdminRepository = makeAdminRepository(supabase);
