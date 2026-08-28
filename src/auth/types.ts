// Types du domaine d'authentification (cahier §6 profiles, §7 roles).

// `saisisseur` = compte de mission : saisit sur UNE base, pour une duree bornee, sans
// jamais posseder de base ni de gabarit (docs/spec-comptes-mission.md).
export type GlobalRole = 'system_admin' | 'medecin' | 'curateur' | 'saisisseur';

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
