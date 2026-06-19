// Types du domaine d'authentification (cahier §6 profiles, §7 roles).

export type GlobalRole = 'system_admin' | 'medecin' | 'curateur' | 'validateur' | 'analyste';

export interface Profile {
  id: string;
  fullName: string;
  globalRole: GlobalRole;
  language: string;
}

export interface SessionUser {
  id: string;
  email: string | null;
}

export type AuthStatus =
  | 'loading' // session en cours de resolution
  | 'unconfigured' // backend Supabase absent (variables d'env manquantes)
  | 'signed_out'
  | 'signed_in';
