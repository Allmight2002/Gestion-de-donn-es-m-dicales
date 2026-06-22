// Logique d'authentification PURE (sans React, sans reseau) -> testable en node.
// C'est ici que vit le "gating par role global" (cahier §7).
import type { GlobalRole, Profile } from './types';

/** Forme brute d'une ligne `profiles` renvoyee par Supabase (snake_case). */
export interface ProfileRow {
  id: string;
  full_name: string | null;
  global_role: string | null;
  language: string | null;
}

const GLOBAL_ROLES: GlobalRole[] = ['system_admin', 'medecin', 'curateur'];

function asGlobalRole(value: string | null | undefined): GlobalRole {
  // Repli defensif sur 'medecin' (le role par defaut a l'inscription ; jamais admin ni staff
  // de curation) : on ne presume JAMAIS un role privilegie pour une valeur inconnue.
  return GLOBAL_ROLES.includes(value as GlobalRole) ? (value as GlobalRole) : 'medecin';
}

/** Le medecin est le seul a creer/posseder des bases (cahier v3.0). */
export function canCreateBase(profile: Profile | null): boolean {
  return profile?.globalRole === 'medecin';
}

/** Convertit une ligne brute en Profile typé (ou null si absente). */
export function mapProfileRow(row: ProfileRow | null | undefined): Profile | null {
  if (!row) return null;
  return {
    id: row.id,
    fullName: row.full_name ?? '',
    globalRole: asGlobalRole(row.global_role),
    language: row.language ?? 'fr',
  };
}

export type AppArea = 'admin' | 'member';

/** Atterrissage selon le role : admin -> gabarits ; curateur/validateur -> pool de
 * curation ; medecin -> tableau de bord (§11). */
export function landingPathFor(profile: Profile): string {
  if (profile.globalRole === 'system_admin') return '/admin';
  if (profile.globalRole === 'curateur') return '/curation';
  return '/';
}

/** Un profil peut-il acceder a une zone applicative ? */
export function isAllowedInArea(profile: Profile | null, area: AppArea): boolean {
  if (!profile) return false;
  // Zone 'admin' = system_admin ; zone 'member' = tout compte authentifie non-admin
  // (medecin + staff). Les actions sensibles sont ensuite gardees finement (creation de
  // base = medecin, etc.).
  return area === 'admin' ? profile.globalRole === 'system_admin' : profile.globalRole !== 'system_admin';
}
